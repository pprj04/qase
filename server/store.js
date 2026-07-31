import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

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

function persistSoon() {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		try {
			fs.mkdirSync(STATE_DIR, { recursive: true });
			fs.writeFileSync(STATE_FILE, JSON.stringify([...sessions.values()], undefined, '\t'));
		} catch {
			// A dashboard that cannot write its history is still a usable dashboard.
		}
	}, 250).unref?.();
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
	} catch {
		// No history yet.
	}
}

export function createSession(title = 'New test run', projectId = undefined) {
	const session = {
		id: randomUUID(),
		title,
		projectId,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		status: 'idle',
		targetUrl: undefined,
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
		capturedSteps: []
	};
	sessions.set(session.id, session);
	persistSoon();
	return session;
}

export function getSession(id) {
	return sessions.get(id);
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
		fs.mkdirSync(STATE_DIR, { recursive: true });
		fs.writeFileSync(STATE_FILE, JSON.stringify([...sessions.values()], undefined, '\t'));
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

