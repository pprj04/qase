import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWrite } from './atomicWrite.js';
// R6-T2 — screenshot artifacts ride the session lifecycle (prune cleanup).
// artifactStore.js imports only atomicWrite.js — verified no import cycle.
import { removeArtifactsForSession } from './artifactStore.js';

/**
 * In-memory session store with a JSON mirror on disk.
 *
 * A session owns everything the dashboard renders: the transcript, the activity
 * feed, findings, the test plan and the final report. Live state that cannot be
 * serialised — the agent runtime, the browser bridge, the abort controller — is
 * kept on a parallel `runtime` record that never reaches disk.
 */

const STATE_DIR = path.join(process.cwd(), '.qase');
const STATE_FILE = path.join(STATE_DIR, 'sessions.json');

/** Live, non-serialisable per-session handles, keyed by session id. */
const live = new Map();

const sessions = new Map();
export const bus = new EventEmitter();
bus.setMaxListeners(0);

let saveTimer;
let pendingWrite = false;

function persistSoon() {
	pendingWrite = true;
	clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		try {
			fs.mkdirSync(STATE_DIR, { recursive: true });
			atomicWrite(STATE_FILE, JSON.stringify([...sessions.values()], undefined, '\t'));
			pendingWrite = false;
		} catch {
			// A dashboard that cannot write its history is still a usable dashboard.
		}
	}, 250).unref?.();
}

/**
 * M1-P4.4 Phase 2 — graceful shutdown flush for sessions. Idempotent.
 */
export function flushSessionsForShutdown() {
	clearTimeout(saveTimer);
	saveTimer = null;
	if (!pendingWrite) return { dirty: false, ok: true };
	try {
		fs.mkdirSync(STATE_DIR, { recursive: true });
		atomicWrite(STATE_FILE, JSON.stringify([...sessions.values()], undefined, '\t'));
		pendingWrite = false;
		return { dirty: true, ok: true };
	} catch (err) {
		return { dirty: true, ok: false, error: err.message };
	}
}

export function loadSessions() {
	try {
		const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
		for (const session of Array.isArray(raw) ? raw : []) {
			// Nothing survives a restart mid-run, so anything that was in flight is stale.
			// P0-F3 — record WHY it was interrupted and, when the agent had a
			// pending question at the crash, PRESERVE it: the user deserves to
			// see what was being asked when the server went down. Deliberate
			// lifecycles (expiry close-out) still clear the question — that is
			// a decision, not an accident. No reason is fabricated for sessions
			// that already carried one from a previous lifecycle event.
			if (session.status === 'running' || session.status === 'awaiting_input') {
				// A running session had no answerable question — any stale
				// pendingQuestion on it is cleared. An awaiting_input session's
				// question was live at crash time and is PRESERVED.
				const wasAwaiting = session.status === 'awaiting_input';
				markSessionInterrupted(session, INTERRUPT_REASONS.SERVER_RESTART_RECOVERY,
					'Interrupted by server restart or recovery',
					{ clearPendingQuestion: !wasAwaiting });
			}
			// Earlier versions stored reasoning as a message; it is live-only now.
			session.messages = (session.messages ?? []).filter(message => message.role !== 'thinking');
			// Backfill capturedSteps for sessions created before Phase 1.
			session.capturedSteps = session.capturedSteps ?? [];
			// Backfill projectId for sessions created before Phase 7.
			session.projectId = session.projectId ?? undefined;
			sessions.set(session.id, session);
		}
	} catch (err) {
		if (err && err.code === 'ENOENT') return; // no history yet — normal first boot
		// M1-P4.4 Phase 5 — damaged store file: preserve for forensics, start
		// empty. Never overwrite a corrupt file with a fresh valid one.
		try {
			fs.renameSync(STATE_FILE, `${STATE_FILE}.corrupt-${Date.now()}`);
			console.error(
				`[sessions] STORE CORRUPT: load failed (${err.message}). File preserved as sessions.json.corrupt-<ts> — starting EMPTY.`
			);
		} catch (renameErr) {
			console.error(`[sessions] STORE CORRUPT: ${err.message} (preserve failed: ${renameErr.message}) — starting EMPTY.`);
		}
	}
}

export function createSession(title = 'New test run', projectId = undefined, options = {}) {
	const session = {
		id: randomUUID(),
		title,
		projectId,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		status: 'idle',
		targetUrl: undefined,
		// B2 — the mission this session executes (set at creation by every
		// mission start path via options.missionId). PERSISTED so the B2
		// revalidation turn pool survives a restart: the debit reads linked
		// sessions from disk. Previously the stamp was in-memory only and
		// only applied on some paths, so the pool saw 0 spent after reboot.
		missionId: options.missionId ?? undefined,
		messages: [],
		activities: [],
		findings: [],
		todos: [],
		report: undefined,
		pendingQuestion: undefined,
		contextUsage: undefined,
		/** Names of secrets held for this session — never the values. */
		secretNames: [],
		/** Browser-action steps captured for workflow extraction. */
		capturedSteps: [],
		/** Optional device request ('iPhone 15 Pro', { device: 'Pixel 8' }, …) for mobile/tablet emulation. Null = desktop. */
		deviceRequest: options.deviceRequest ?? undefined,
		/**
		 * C4 — explicit execution provider requested by mission configuration
		 * ('browserstack' | 'local'). Undefined/null = local (default). Set at
		 * creation only — the LLM has no tool that changes it mid-mission.
		 */
		executionProvider: options.executionProvider ?? undefined,
		/** C4 — truthful execution provenance once the runtime has launched (agent path). */
		execution: undefined,
		/** Resolved device context (set by the agent runtime once applied). */
		device: undefined,
		/**
		 * P0-F4 — owning user (qase_session user id) for server-side isolation.
		 * null = master/open-created or pre-F4 legacy record (shared history).
		 */
		ownerUserId: options.ownerUserId ?? null
	};
	sessions.set(session.id, session);
	persistSoon();
	return session;
}

export function getSession(id) {
	return sessions.get(id);
}

/**
 * Phase 9.3: Session pruning — keep the N most recent sessions so the
 * sessions.json state file stays bounded. Findings from pruned sessions
 * already live in the findings store; only the session shells are dropped.
 *
 * M1-P3 Phase 5 (Option A): pruning is now ALSO byte-bounded. Count-based
 * pruning alone let heavyweight agent sessions (multi-MB messages[]) blow
 * past the 15MB hygiene bound (observed 58 sessions / 31.9MB). After the
 * count cap, evict oldest-first until the payload is under BUDGET_BYTES,
 * always keeping at least MIN_KEEP sessions so a fresh install never prunes
 * itself to zero.
 */
const SESSION_COUNT_KEEP = 50;
const SESSION_BYTE_BUDGET = 12 * 1024 * 1024; // 12MB — under the 15MB test bound with margin
const SESSION_MIN_KEEP = 5;

export function pruneOldSessions(keep = SESSION_COUNT_KEEP) {
	const all = [...sessions.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
	let survivors = all.slice(0, keep);
	const doomed = all.slice(keep);
	// Byte-budget pass: evict from the OLDEST end of the survivors until the
	// persisted payload fits. findLastIndex finds the oldest index that still
	// fits, so everything after it is dropped.
	// NOTE: budget is computed against the PERSISTED form (pretty-printed with
	// tabs — see persistSoon), not the compact form: JSON.stringify with an
	// indent multiplies payload size ~29% on deep session objects, and RL-1
	// reads the file on disk.
	let payload = 0;
	for (const session of survivors) payload += JSON.stringify(session, undefined, '\t').length;
	if (payload > SESSION_BYTE_BUDGET) {
		let cutoff = survivors.length;
		let running = 0;
		for (let i = 0; i < survivors.length; i += 1) {
			const size = JSON.stringify(survivors[i], undefined, '\t').length;
			if (running + size > SESSION_BYTE_BUDGET || survivors.length - i < SESSION_MIN_KEEP) break;
			running += size;
			cutoff = i + 1;
		}
		doomed.push(...survivors.slice(cutoff));
		survivors = survivors.slice(0, cutoff);
	}
	for (const session of doomed) {
		// R2-B/G6 — never orphan a browser: dispose the live record (bridge +
		// runtime) and remove the session workspace BEFORE the record leaves
		// the map. After sessions.delete the session is invisible to every
		// later cleanup pass, so this is the last chance for its Chromium.
		const record = live.get(session.id);
		if (record) {
			try {
				record.dispose?.();
			} catch (err) {
				console.error(`[prune] dispose failed for ${session.id}: ${err?.message ?? err}`);
			}
			live.delete(session.id);
		}
		// R2-B/G2 — remove the session's scratch workspace (idempotent;
		// kernel-corrupted dirs throw EUCLEAN and are skipped silently —
		// they predate the ownership model).
		try {
			fs.rmSync(path.join(process.cwd(), '.qase', 'workspaces', session.id), { recursive: true, force: true });
		} catch { /* best-effort: fs corruption */ }
		// R6-T2 — budget-pruned sessions take their screenshot artifacts with
		// them (same lifecycle anchor: the session record). Static import:
		// artifactStore.js imports only atomicWrite.js — no cycle.
		try {
			removeArtifactsForSession(session.id);
		} catch { /* best-effort: artifact cleanup must never block pruning */ }
		sessions.delete(session.id);
	}
	if (doomed.length > 0) {
		persistSoon();
	}
	return doomed.length;
}

/**
 * Phase 9.3: persist the session store now (bypasses the debounce).
 * Used after cleanup pass slimming, where no add/delete happens to
 * trigger persistSoon() naturally.
 */
export function persistSessionsNow() {
	clearTimeout(saveTimer);
	try {
		fs.mkdirSync(STATE_DIR, { recursive: true });
		atomicWrite(STATE_FILE, JSON.stringify([...sessions.values()], undefined, '\t'));
	} catch {
		// Non-fatal.
	}
}

export function listSessions({ projectId, ownerFilter } = {}) {
	return [...sessions.values()]
		.filter(s => !projectId || s.projectId === projectId)
		// P0-F4 — server-side owner scoping: a user-kind caller only ever
		// sees their own + shared legacy sessions, regardless of frontend.
		.filter(s => ownerFilter == null || ownerFilter(s))
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.map(session => ({
			id: session.id,
			title: session.title,
			projectId: session.projectId,
			status: session.status,
			targetUrl: session.targetUrl,
			missionId: session.missionId ?? null,
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
			findingCount: session.findings.length,
			messageCount: session.messages.length,
			ownerUserId: session.ownerUserId ?? null
		}));
}

export function deleteSession(id) {
	const record = live.get(id);
	record?.dispose?.();
	live.delete(id);
	const existed = sessions.delete(id);
	// R2-B/G2 — remove the session's scratch workspace with the record.
	// Idempotent (force), best-effort on corrupt filesystems.
	try {
		fs.rmSync(path.join(process.cwd(), '.qase', 'workspaces', id), { recursive: true, force: true });
	} catch { /* best-effort: fs corruption */ }
	persistSoon();
	return existed;
}

/** Live handles (runtime, bridge, abort controller) for a session. */
export function liveFor(id) {
	let record = live.get(id);
	if (!record) {
		record = {};
		live.set(id, record);
	}
	return record;
}

/** Events that exist only for the live view and are not worth a disk write. */
const EPHEMERAL = new Set(['frame', 'cursor', 'reasoning', 'message_delta', 'turn']);

/**
 * Applies a mutation and broadcasts it. Every state change in the app funnels
 * through here, so the SSE stream and the stored session can never disagree.
 */
export function emit(session, type, payload = {}) {
	if (!EPHEMERAL.has(type)) {
		session.updatedAt = Date.now();
		persistSoon();
	}
	bus.emit(session.id, { type, sessionId: session.id, ts: Date.now(), ...payload });
}

export function addMessage(session, message) {
	const entry = { id: randomUUID(), ts: Date.now(), ...message };
	session.messages.push(entry);
	emit(session, 'message', { message: entry });
	return entry;
}

export function addActivity(session, activity) {
	const entry = { id: activity.id ?? randomUUID(), ts: Date.now(), status: 'done', ...activity };
	session.activities.push(entry);
	// The feed is a live view, not an audit log; old entries fall off the back.
	if (session.activities.length > 500) {
		session.activities.splice(0, session.activities.length - 500);
	}
	emit(session, 'activity', { activity: entry });
	return entry;
}

export function updateActivity(session, id, patch) {
	const entry = session.activities.find(candidate => candidate.id === id);
	if (!entry) {
		return undefined;
	}
	Object.assign(entry, patch);
	emit(session, 'activity', { activity: entry });
	return entry;
}

export function setStatus(session, status, detail) {
	session.status = status;
	// R2-A/G3 — stamp when the session began awaiting input; the watchdog
	// expiry reads this (updatedAt fallback for legacy rows).
	if (status === 'awaiting_input') {
		session.awaitingInputSince = Date.now();
	} else if (session.awaitingInputSince !== undefined) {
		session.awaitingInputSince = undefined;
	}
	emit(session, 'status', { status, detail });
}

/**
 * P0-F3 — the ONE place a session becomes 'interrupted', so the reason is
 * always truthful and persisted. Semantics:
 *   reason     — machine code, one of INTERRUPT_REASONS (persisted as
 *                session.interruptedReason; an existing reason is never
 *                overwritten by a later transition).
 *   clearPendingQuestion — DELIBERATE lifecycles (expiry, stuck detection,
 *                max-duration abort) end the Q&A; the pending question is no
 *                longer answerable, so it is cleared with a recorded
 *                interruptedWhile. An accidental restart interruption KEEPS
 *                the question (loadSessions) — it stays answerable context.
 */
export const INTERRUPT_REASONS = Object.freeze({
	SERVER_RESTART_RECOVERY: 'server_restart_recovery',
	AWAITING_INPUT_TIMEOUT: 'awaiting_input_timeout',
	WATCHDOG_STUCK: 'watchdog_stuck',
	MAX_RUNNING_DURATION: 'max_running_duration'
});

export function markSessionInterrupted(session, reason, detail, { clearPendingQuestion = false } = {}) {
	const wasAwaitingInput = session.status === 'awaiting_input';
	const hadPendingQuestion = Boolean(session.pendingQuestion);
	session.status = 'interrupted';
	if (!session.interruptedReason) {
		session.interruptedReason = reason;
	}
	session.interruptedAt = session.interruptedAt ?? Date.now();
	session.interruptedWhile = session.interruptedWhile
		?? (wasAwaitingInput ? 'awaiting_input' : undefined);
	if (clearPendingQuestion && hadPendingQuestion) {
		session.pendingQuestion = undefined;
	}
	session.awaitingInputSince = undefined;
	emit(session, 'status', {
		status: 'interrupted',
		detail,
		interruptedReason: session.interruptedReason,
		interruptedWhile: session.interruptedWhile ?? null
	});
}

/** Immediately persist all in-memory sessions to disk. */
export function saveSessions() {
	try {
		atomicWrite(STATE_FILE, JSON.stringify([...sessions.values()], undefined, '\t'));
	} catch {
		// best-effort
	}
}

/**
 * Reassign: move all sessions from fromProjectId to toProjectId.
 * Operates directly on the internal Map.
 * Returns the number of sessions moved.
 */
export function reassignProjectId(fromProjectId, toProjectId) {
	let count = 0;
	for (const session of sessions.values()) {
		if (session.projectId === fromProjectId) {
			session.projectId = toProjectId;
			count++;
		}
	}
	if (count > 0) saveSessions();
	return count;
}

/**
 * Backfill: assign defaultId to every session missing a projectId.
 * Operates directly on the internal Map (listSessions returns copies).
 * Returns the number of sessions updated.
 */
export function backfillProjectId(defaultId) {
	let count = 0;
	for (const session of sessions.values()) {
		if (!session.projectId) {
			session.projectId = defaultId;
			count++;
		}
	}
	if (count > 0) saveSessions();
	return count;
}

/* ── Phase 1: Stuck Session Watchdog ────────────────────────────── */

/**
 * Detects sessions stuck in 'running' status whose live record shows no
 * active controller. This can happen when:
 *   - The runTurn promise was rejected outside the catch block
 *   - The process was under memory pressure and dropped an event
 *   - An unhandled promise rejection left record.running stale
 *
 * The watchdog runs periodically and marks such sessions as 'interrupted'
 * so they don't block the UI or hold mission status forever.
 */

const WATCHDOG_INTERVAL_MS = 60_000; // check every 60s
const MAX_RUNNING_DURATION_MS = 30 * 60 * 1000; // 30 min same as agent timeout
/** R2-A/G3 — awaiting_input default timeout when config is unavailable. */
const DEFAULT_AWAITING_INPUT_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * R2-A/G3 — clock seam for the awaiting_input expiry. Tests substitute a
 * fake clock via __setWatchdogClock; production returns real time.
 */
let watchdogClock = () => Date.now();
export function __setWatchdogClock(fn) { watchdogClock = typeof fn === 'function' ? fn : () => Date.now(); }

/**
 * R2-A/G3 — close-out callback for awaiting_input expiry. The session store
 * owns detection (it owns the sweep); the app layer (index.js) owns browser
 * close + mission finalization, injected here to avoid a store→agent import.
 */
let awaitingInputExpiryHandler = null;
export function setAwaitingInputExpiryHandler(fn) { awaitingInputExpiryHandler = fn; }

let watchdogTimer = null;

/** R2-A/G3 — timeout ms from config, clamped to the documented 5–1440 min range. */
function awaitingInputTimeoutMs() {
	try {
		const getConfig = globalThis.__qaseAwaitingInputConfig?.getConfig;
		const mins = Number(getConfig?.().awaitingInputTimeoutMinutes);
		if (Number.isFinite(mins) && mins >= 5 && mins <= 1440) return mins * 60_000;
	} catch { /* config unavailable → default */ }
	return DEFAULT_AWAITING_INPUT_TIMEOUT_MS;
}

function runWatchdog() {
	const now = watchdogClock();
	for (const session of sessions.values()) {
		// R2-A/G3 — awaiting_input expiry. A mission paused for user input
		// previously held its browser + session record FOREVER (this sweep
		// skipped it, resource cleanup excluded it, BROWSER_IDLE_MS=0).
		// Now: past the configured timeout the session is interrupted here
		// and handed to the app-layer close-out (browser + mission), which is
		// guarded by expiryClosingOut so governor sweeps cannot race it.
		if (session.status === 'awaiting_input') {
			const record = liveFor(session.id);
			if (record?.expiryClosingOut) continue;
			const limitMs = awaitingInputTimeoutMs();
			const enteredAt = session.awaitingInputSince ?? session.updatedAt;
			if (now - enteredAt > limitMs) {
				record.expiryClosingOut = true;
				// Deliberate lifecycle: the Q&A window closed — the pending
				// question is no longer answerable, so it is cleared and the
				// reason recorded truthfully.
				markSessionInterrupted(session, INTERRUPT_REASONS.AWAITING_INPUT_TIMEOUT,
					`awaiting_input_timeout: no answer arrived before the configured limit (${Math.round(limitMs / 60000)} minutes)`,
					{ clearPendingQuestion: true });
				const pending = { sessionId: session.id, enteredAt };
				// Handler is the index.js close-out: await closeBrowser +
				// finalizeMissionFromSession. It clears record.expiryClosingOut
				// when done — including on failure, so a failed close-out
				// does not wedge the session invisible to the governor.
				if (typeof awaitingInputExpiryHandler === 'function') {
					Promise.resolve(awaitingInputExpiryHandler(session, pending)).catch(() => {});
				}
			}
			continue;
		}
		if (session.status !== 'running') continue;

		const record = live.get(session.id);
		// Case 1: record.running is false but session.status is still 'running'
		if (record && record.running === false) {
			console.warn(`[watchdog] Session ${session.id} stuck in 'running' but not actually running — marking interrupted`);
			markSessionInterrupted(session, INTERRUPT_REASONS.WATCHDOG_STUCK,
				'Detected stuck by watchdog', { clearPendingQuestion: true });
			continue;
		}

		// Case 2: session has been running too long with no update
		if (now - session.updatedAt > MAX_RUNNING_DURATION_MS) {
			console.warn(`[watchdog] Session ${session.id} exceeded max running duration (${Math.round((now - session.updatedAt) / 1000)}s) — marking interrupted`);
			record?.controller?.abort();
			markSessionInterrupted(session, INTERRUPT_REASONS.MAX_RUNNING_DURATION,
				'Exceeded max running duration', { clearPendingQuestion: true });
		}
	}
}

/**
 * Starts the periodic watchdog. Called once on server boot.
 */
export function startWatchdog() {
	if (watchdogTimer) return;
	watchdogTimer = setInterval(runWatchdog, WATCHDOG_INTERVAL_MS);
	watchdogTimer.unref?.();
}

/** Stops the watchdog (for testing). */
export function stopWatchdog() {
	clearInterval(watchdogTimer);
	watchdogTimer = null;
}

/** R2-A/G3 — test seam: run one watchdog sweep immediately (fake-clock tests). */
export function __runWatchdogOnce() { runWatchdog(); }

