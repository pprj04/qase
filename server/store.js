import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWrite } from './atomicWrite.js';

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
			if (session.status === 'running' || session.status === 'awaiting_input') {
				session.status = 'interrupted';
				session.pendingQuestion = undefined;
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
		/** Resolved device context (set by the agent runtime once applied). */
		device: undefined
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

export function listSessions({ projectId } = {}) {
	return [...sessions.values()]
		.filter(s => !projectId || s.projectId === projectId)
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
			messageCount: session.messages.length
		}));
}

export function deleteSession(id) {
	const record = live.get(id);
	record?.dispose?.();
	live.delete(id);
	const existed = sessions.delete(id);
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
	emit(session, 'status', { status, detail });
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

let watchdogTimer = null;

function runWatchdog() {
	const now = Date.now();
	for (const session of sessions.values()) {
		if (session.status !== 'running') continue;

		const record = live.get(session.id);
		// Case 1: record.running is false but session.status is still 'running'
		if (record && record.running === false) {
			console.warn(`[watchdog] Session ${session.id} stuck in 'running' but not actually running — marking interrupted`);
			session.status = 'interrupted';
			session.pendingQuestion = undefined;
			emit(session, 'status', { status: 'interrupted', detail: 'Detected stuck by watchdog' });
			continue;
		}

		// Case 2: session has been running too long with no update
		if (now - session.updatedAt > MAX_RUNNING_DURATION_MS) {
			console.warn(`[watchdog] Session ${session.id} exceeded max running duration (${Math.round((now - session.updatedAt) / 1000)}s) — marking interrupted`);
			record?.controller?.abort();
			session.status = 'interrupted';
			session.pendingQuestion = undefined;
			emit(session, 'status', { status: 'interrupted', detail: 'Exceeded max running duration' });
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

