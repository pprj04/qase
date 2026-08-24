/**
 * M1-P4.2 — Mission Execution Governor.
 *
 * Single in-process authority that bounds concurrent AGENT mission
 * executions (one slot = one session + Chromium + LLM conversation) and
 * queues the rest. Every path that starts mission execution routes through
 * submit(); nothing bypasses the gate to consume a slot directly.
 *
 * Lifecycle: CREATED → QUEUED → RUNNING → COMPLETED | FAILED | ABORTED |
 * CANCELLED (queue-only cancels) — plus the pre-existing `interrupted`
 * (restart recovery) and `timeout` (declared, reserved) states.
 *
 * Design notes (docs/M1-P4.2-CONCURRENCY-AUDIT.md):
 *  - FIFO queue, stable mission IDs, duplicate submissions are idempotent.
 *  - Terminal releases (completed/failed/aborted/cancelled/interrupted) are
 *    detected by subscribing to the mission bus + a 5s backstop sweep that
 *    reconciles held slots against persisted mission status.
 *  - A watchdog (30s) closes the stuck-mission paths observed in M1-P4.1:
 *    sessions that settled (idle/done/error/interrupted, runtime not
 *    running) while the mission still says `running` are settled through
 *    the SAME honesty finalizer the lazy GET path uses — no duplicated
 *    verdict logic. A hard wall-clock cap fails a mission outright.
 *  - No persistence of the queue itself: on restart, persisted `queued`
 *    missions are re-submitted (a queued mission never had a worker, so
 *    this cannot falsely resume an execution).
 */

import { getConfig } from './config.js';

/* ── Internals ───────────────────────────────────────────────────── */

/** Mission IDs holding an execution slot, insertion-ordered. */
const active = new Set();
/** FIFO of { missionId, start, submittedAt }. */
const queue = [];
/** Set of mission IDs currently known to the governor (active or queued). */
const known = new Set();
/** Per-mission start functions (a queued mission keeps its own start). */
const starts = new Map();

let log = () => {};
/** Test-only override for the config surface (see __resetForTests). */
let configOverride = null;
/** Wired by index.js: settle a stuck running mission via the honesty finalizer. */
let onStuck = null;
/** Wired by index.js: hard-fail a mission that exceeded the wall-clock cap. */
let onTimeout = null;
/** Wired by index.js: resolve a mission's CURRENT execution session id (or null). */
let getSessionIdFor = null;
/** Wired by index.js: session-store probes for the stuck detector. */
let probeSession = () => ({ settled: false, running: false });

let watchdogTimer = null;

function maxSlots() {
	// configOverride is a { getConfig } test double; call through it when set.
	const source = configOverride ? configOverride.getConfig() : getConfig();
	const n = Number(source.maxConcurrentMissions);
	return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3;
}

function timeoutMinutes() {
	const source = configOverride ? configOverride.getConfig() : getConfig();
	const n = Number(source.missionTimeoutMinutes);
	return Number.isFinite(n) && n >= 5 ? Math.floor(n) : 60;
}

/* ── Queue ───────────────────────────────────────────────────────── */

/**
 * Submit a mission for execution.
 *
 * - If a slot is free: marks RUNNING (caller-stamped startedAt), invokes
 *   onStart(missionId) which performs the actual createSession/agent kick.
 * - If all slots are busy: the mission is marked `queued` (queuedAt
 *   stamped) and will start when a slot frees.
 * - Idempotent: a mission already active or queued is not double-entered.
 *
 * @returns {'started' | 'queued' | 'already-tracked'}
 */
export function submitMission(missionId, start) {
	if (typeof start !== 'function') {
		throw new TypeError('[governor] submitMission requires a start function');
	}
	if (known.has(missionId)) return 'already-tracked';
	known.add(missionId);
	if (active.size < maxSlots()) {
		active.add(missionId);
		// The start function travels WITH the mission — pump must invoke the
		// queued mission's own start, never whichever callback was submitted last.
		starts.set(missionId, start);
		log(`[governor] mission ${missionId} → RUNNING (slot ${active.size}/${maxSlots()})`);
		try {
			start(missionId);
		} catch (error) {
			// onStart throwing must never wedge the slot.
			log(`[governor] onStart failed for ${missionId}: ${error?.message ?? error} — releasing slot`);
			active.delete(missionId);
			known.delete(missionId);
			starts.delete(missionId);
			throw error;
		}
		return 'started';
	}
	queue.push({ missionId, start, submittedAt: Date.now() });
	log(`[governor] mission ${missionId} → QUEUED (position ${queue.length}, ${active.size}/${maxSlots()} slots busy)`);
	return 'queued';
}

/** Grant the next queued mission a slot. Grants exactly one slot per call. */
function pump() {
	while (queue.length > 0 && active.size < maxSlots()) {
		const { missionId, start } = queue.shift();
		if (!known.has(missionId)) continue; // cancelled while queued
		active.add(missionId);
		starts.set(missionId, start);
		log(`[governor] mission ${missionId} QUEUED → RUNNING (slot ${active.size}/${maxSlots()})`);
		try {
			start(missionId);
		} catch (error) {
			log(`[governor] onStart failed for ${missionId}: ${error?.message ?? error} — releasing slot`);
			active.delete(missionId);
			known.delete(missionId);
			starts.delete(missionId);
			continue; // try the next queued mission
		}
		return; // one grant per pump; the next release pumps again
	}
}

/**
 * Explicit release (idempotent). Called when a mission reaches any terminal
 * state. Triggers a pump so a queued mission starts immediately.
 */
export function releaseMission(missionId) {
	const wasActive = active.delete(missionId);
	const wasQueued = dequeue(missionId);
	starts.delete(missionId);
	if (wasActive || wasQueued) {
		log(`[governor] mission ${missionId} released (was ${wasActive ? 'active' : 'queued'})`);
	}
	if (wasActive) pump();
	return wasActive || wasQueued;
}

function dequeue(missionId) {
	const index = queue.findIndex(entry => entry.missionId === missionId);
	if (index === -1) return false;
	queue.splice(index, 1);
	return true;
}

/* ── Cancellation ────────────────────────────────────────────────── */

/**
 * Cancel a mission known to the governor.
 * QUEUED → removed from the queue, never executes (caller stamps the
 * mission `cancelled`). RUNNING → false (the caller uses the existing
 * abort architecture — this is not a second one).
 * @returns {'cancelled-queued' | 'running' | 'unknown'}
 */
export function cancelMission(missionId) {
	if (known.has(missionId) && !active.has(missionId)) {
		dequeue(missionId);
		known.delete(missionId);
		return 'cancelled-queued';
	}
	if (active.has(missionId)) return 'running';
	return 'unknown';
}

/* ── Watchdog ────────────────────────────────────────────────────── */

function sweep() {
	// 1. Reconcile held slots against mission status written by any path
	//    (finalizers, stop handler, reaper). Status lookup is injected via
	//    onStuck's sibling: getMissionStatus wired by index.js.
	const terminal = new Set(['completed', 'failed', 'aborted', 'cancelled', 'timeout', 'interrupted']);
	for (const missionId of [...active]) {
		const status = getMissionStatus?.(missionId);
		if (status && terminal.has(status)) {
			log(`[governor] sweep: mission ${missionId} is terminal (${status}) — releasing slot`);
			releaseMission(missionId);
			continue;
		}
		// 2. Hard wall-clock: a single execution may not run forever.
		const startedAt = getMissionStartedAt?.(missionId);
		if (startedAt && Date.now() - startedAt > timeoutMinutes() * 60_000) {
			log(`[governor] mission ${missionId} exceeded ${timeoutMinutes()}min wall clock — failing`);
			try {
				onTimeout?.(missionId);
			} catch (error) {
				log(`[governor] onTimeout failed: ${error?.message ?? error}`);
			}
			// onTimeout writes a terminal status; release immediately so a
			// broken handler can't hold the slot hostage.
			releaseMission(missionId);
			continue;
		}
		// 3. Stuck detector: mission says running, but its session settled.
		const sessionId = getSessionIdFor?.(missionId);
		if (!sessionId) continue;
		const probe = probeSession(sessionId);
		if (probe.settled && !probe.running) {
			const settled = probe.settledAt ?? Date.now();
			if (Date.now() - settled > 90_000) {
				log(`[governor] mission ${missionId} session settled ${probe.status} ≥90s ago — invoking honesty finalizer`);
				try {
					onStuck?.(missionId);
				} catch (error) {
					log(`[governor] onStuck failed: ${error?.message ?? error}`);
				}
				// The finalizer writes a terminal status; next sweep releases
				// the slot (or the bus event does immediately).
			}
		}
	}
	// 4. Orphan queue entries whose mission went terminal while queued.
	for (const { missionId } of [...queue]) {
		const status = getMissionStatus?.(missionId);
		if (status && terminal.has(status)) {
			log(`[governor] sweep: queued mission ${missionId} is terminal (${status}) — dropping from queue`);
			dequeue(missionId);
			known.delete(missionId);
		}
	}
}

let getMissionStatus = null;
let getMissionStartedAt = null;

export function startGovernorWatchdog({ getMissionStatus: gms, getMissionStartedAt: gsa, onStuck: stuck, onTimeout: timeout, getSessionIdFor: gsif, probeSession: probe, log: logger } = {}) {
	getMissionStatus = gms;
	getMissionStartedAt = gsa;
	onStuck = stuck;
	onTimeout = timeout;
	getSessionIdFor = gsif;
	probeSession = probe ?? (() => ({ settled: false, running: false }));
	log = logger ?? (() => {});
	stopGovernorWatchdog();
	watchdogTimer = setInterval(sweep, 30_000);
	watchdogTimer.unref?.();
}

export function stopGovernorWatchdog() {
	if (watchdogTimer) {
		clearInterval(watchdogTimer);
		watchdogTimer = null;
	}
}

/* ── Introspection (API surface) ─────────────────────────────────── */

export function governorStats() {
	return {
		maxConcurrentMissions: maxSlots(),
		missionTimeoutMinutes: timeoutMinutes(),
		activeCount: active.size,
		queueDepth: queue.length,
		active: [...active],
		queue: queue.map(entry => entry.missionId)
	};
}

/** 1-based position of a queued mission, 0 if not queued. */
export function queuePositionOf(missionId) {
	const index = queue.findIndex(entry => entry.missionId === missionId);
	return index === -1 ? 0 : index + 1;
}

/** Test hook: forget everything (unit tests only). */
export function __resetForTests(config = null) {
	active.clear();
	queue.length = 0;
	known.clear();
	starts.clear();
	configOverride = config; // { getConfig } test double, or null → live config
}
