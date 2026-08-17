/**
 * Mission Store
 *
 * A Mission is the top-level quality evaluation unit. It wraps one or more
 * execution sessions, carries objectives and capabilities, and produces a
 * quality score, verdict, and improvement prompt.
 *
 * This is an ADDITIVE layer — Sessions continue to exist and work exactly as
 * before. A Mission references a session by ID; it does not replace it.
 *
 * Persistence follows the same pattern as store.js / findings.js:
 *   in-memory Map + debounced JSON mirror to .qase/missions.json
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { getDefaultProjectId } from './projects.js';
import { atomicWrite } from './atomicWrite.js';

/* ── Constants ──────────────────────────────────────────────────── */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = join(__dirname, '..', '.qase', 'missions.json');
export const MISSION_TYPES = [
	'full_audit', 'security', 'ux', 'regression', 'feature_gap', 'accessibility'
];
export const MISSION_STATUS = [
	'created', 'queued', 'running', 'completed', 'failed', 'aborted', 'cancelled', 'timeout'
];

/**
 * Phase 1 reliability: terminal states that cannot be transitioned out of.
 * A mission in a terminal state rejects start/iterate operations.
 */
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'aborted', 'cancelled', 'timeout']);

/** True if the mission status is terminal (no further transitions allowed). */
export function isTerminalStatus(status) {
	return TERMINAL_STATUSES.has(status);
}

/* ── Storage ───────────────────────────────────────────────────── */

const store = new Map();
const bus = new EventEmitter();
bus.setMaxListeners(0);

let saveTimer = null;
let dirty = false;

function loadMissions() {
	try {
		if (!existsSync(FILE)) return;
		const raw = readFileSync(FILE, 'utf8');
		const arr = JSON.parse(raw);
		if (Array.isArray(arr)) {
			for (const m of arr) store.set(m.id, m);
		}
	} catch (err) {
		console.error('[missions] load failed:', err.message);
	}
}

function scheduleSave() {
	dirty = true;
	if (saveTimer) return;
	saveTimer = setTimeout(() => {
		saveTimer = null;
		if (!dirty) return;
		dirty = false;
			try {
				mkdirSync(dirname(FILE), { recursive: true });
				const arr = [...store.values()];
				atomicWrite(FILE, JSON.stringify(arr, null, 2));
			} catch (err) {
			console.error('[missions] save failed:', err.message);
		}
	}, 500);
}

/* ── CRUD ──────────────────────────────────────────────────────── */

/**
 * Create a new mission.
 *
 * @param {object} data
 * @param {string} [data.projectId]     — defaults to default project
 * @param {string} [data.type]          — defaults to 'full_audit'
 * @param {string} [data.name]
 * @param {string} [data.targetUrl]
 * @param {string[]} [data.objectives]  — what we're validating
 * @param {string[]} [data.capabilities]— which validation capabilities to run
 * @param {object} [data.successCriteria]
 * @param {string} [data.source]        — 'manual' | 'ai_studio' | 'ci_cd'
 * @param {string} [data.generationId]  — AI Studio generation identifier
 * @param {object} [data.constraints]   — viewport, auth, scope constraints
 * @returns {object} the created mission
 */
export function createMission(data = {}) {
	const id = data.id || randomUUID();
	const now = Date.now();
	const projectId = data.projectId || getDefaultProjectId();

	const mission = {
		id,
		projectId,
		// Phase 10: workspace + identity traceability
		workspaceId: data.workspaceId || null,
		createdByUserId: data.createdByUserId || null,
		correlationId: data.correlationId || null,
		idempotencyKey: data.idempotencyKey || null,
		name: data.name || `Mission ${new Date(now).toLocaleString()}`,
		type: MISSION_TYPES.includes(data.type) ? data.type : 'full_audit',
		targetUrl: data.targetUrl || null,
		objectives: Array.isArray(data.objectives) ? data.objectives : [],
		capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
		successCriteria: data.successCriteria || {},
		constraints: data.constraints || {},
		source: data.source || 'manual',
		generationId: data.generationId || null,

		// ── Mission Context (ground truth from input source) ──
		// buildPrompt: "Build a CRM with leads and invoicing"
		// requirements: ["user auth", "data export"]
		// testCredentials: { username, password }
		// businessGoals: "Increase conversion by 20%"
		context: data.context || null,

		status: 'created',
		sessionId: null,          // current/last execution session
		qualityScore: null,       // 0-100, set on completion
		verdict: null,            // 'pass' | 'pass_with_issues' | 'fail'
		improvementPrompt: null,  // AI Studio regeneration prompt
		releaseReady: null,       // boolean

		findings: [],
		summary: null,

		// ── Continuous Validation Loop ──
		// Each iteration is a complete validation run with its own session.
		// Iterations enable: validate → improve → validate again → compare → approve.
		iterations: [],           // [{ number, sessionId, findings, qualityScore, verdict, ranAt, status }]
		currentIteration: 0,      // 0 = not started, 1+ = iteration count

		// ── Execution Timing ──
		startedAt: null,          // Set when mission transitions to 'running'
		estimatedDuration: null,  // Estimated total execution time (ms), computed from history

		createdAt: now,
		updatedAt: now,
		completedAt: null
	};

	store.set(id, mission);
	scheduleSave();
	bus.emit('mission:created', mission);
	return mission;
}

export function getMission(id) {
	return store.get(id) || null;
}

/**
 * Phase 10: Find an existing mission by idempotency key.
 * Used to deduplicate repeated integration requests.
 *
 * @param {string} key — idempotency key
 * @returns {object|null}
 */
export function findByIdempotencyKey(key) {
	if (!key) return null;
	for (const mission of store.values()) {
		if (mission.idempotencyKey === key) return mission;
	}
	return null;
}

export function listMissions({ projectId, status, type, source, workspaceId, correlationId } = {}) {
	let list = [...store.values()];
	if (projectId) list = list.filter(m => m.projectId === projectId);
	if (status) list = list.filter(m => m.status === status);
	if (type) list = list.filter(m => m.type === type);
	if (source) list = list.filter(m => m.source === source);
	// Phase 10: workspace + correlation filtering
	if (workspaceId) list = list.filter(m => m.workspaceId === workspaceId);
	if (correlationId) list = list.filter(m => m.correlationId === correlationId);
	list.sort((a, b) => b.updatedAt - a.updatedAt);
	return list;
}

/**
 * Patch a mission. Only known top-level fields are updated.
 * Emits 'mission:updated' with the patched mission.
 */
export function updateMission(id, patch = {}) {
	const mission = store.get(id);
	if (!mission) return null;

	const allowed = [
		'name', 'type', 'targetUrl', 'objectives', 'capabilities',
		'successCriteria', 'constraints', 'status', 'sessionId',
		'qualityScore', 'verdict', 'improvementPrompt', 'releaseReady',
		'findings', 'summary', 'completedAt',
		'iterations', 'currentIteration', 'context',
		// Phase 5: Continuous Validation Loop fields
		'stopReason', 'iterationMetadata',
		// Phase 10: Integration identity fields (set at creation, not mutated later)
		'workspaceId', 'correlationId',
		// Execution timing
		'startedAt', 'estimatedDuration'
	];

	for (const key of allowed) {
		if (key in patch) mission[key] = patch[key];
	}

	mission.updatedAt = Date.now();
	scheduleSave();
	bus.emit('mission:updated', mission);
	return mission;
}

/**
 * Attach a finding to a mission (additive — does not mutate the finding).
 */
export function attachFinding(missionId, finding) {
	const mission = store.get(missionId);
	if (!mission) return null;
	mission.findings.push(finding);
	mission.updatedAt = Date.now();
	scheduleSave();
	bus.emit('mission:finding', { missionId, finding });
	return mission;
}

/**
 * Finalize a mission — set quality score, verdict, improvement prompt.
 *
 * Phase 1 reliability: idempotency guard. If the mission is already in a
 * terminal state (completed/failed/aborted), the call is a no-op and
 * returns the existing mission. This prevents double-finalization from
 * the race between pipeline completion and lazy finalization on GET.
 */
export function finalizeMission(id, results = {}) {
	const mission = store.get(id);
	if (!mission) return null;

	// Idempotency: already finalized — return as-is
	if (TERMINAL_STATUSES.has(mission.status)) {
		return mission;
	}

	mission.status = results.status || 'completed';
	mission.qualityScore = results.qualityScore ?? null;
	mission.verdict = results.verdict || null;
	mission.improvementPrompt = results.improvementPrompt || null;
	mission.releaseReady = results.releaseReady ?? null;
	mission.summary = results.summary || mission.summary;
	mission.completedAt = Date.now();
	mission.updatedAt = Date.now();

	scheduleSave();
	bus.emit('mission:finalized', mission);
	return mission;
}

export function deleteMission(id) {
	const existed = store.delete(id);
	if (existed) {
		scheduleSave();
		bus.emit('mission:deleted', id);
	}
	return existed;
}

/**
 * Estimates execution duration for a new mission based on historical data.
 * Uses completed missions of the same type with known timing.
 *
 * Returns null if insufficient data (< 3 completed missions with timing).
 *
 * @param {string} [missionType] — optional type filter
 * @returns {number|null} estimated duration in ms, or null
 */
export function estimateDuration(missionType) {
	const completed = [...store.values()].filter(m =>
		m.status === 'completed' &&
		m.startedAt &&
		m.completedAt &&
		(!missionType || m.type === missionType)
	);

	if (completed.length < 3) return null;

	// Use median of historical durations for robustness against outliers
	const durations = completed
		.map(m => m.completedAt - m.startedAt)
		.sort((a, b) => a - b);

	const mid = Math.floor(durations.length / 2);
	return durations.length % 2 === 0
		? Math.round((durations[mid - 1] + durations[mid]) / 2)
		: durations[mid];
}

/**
 * Records a completed iteration on a mission. Called when a validation
 * run finishes. Stores the session, findings, and quality score for
 * this iteration so future iterations can compare against it.
 *
 * @param {string} id — mission ID
 * @param {object} iterationData — { sessionId, findings, qualityScore, verdict }
 * @returns {object|null} the updated mission
 */
export function recordIteration(id, iterationData = {}) {
	const mission = store.get(id);
	if (!mission) return null;

	// Guard against double-recording from the same session (race between
	// pipeline finalize and lazy finalize on GET /api/v1/missions/:id).
	if (iterationData.sessionId && mission.iterations.some(it => it.sessionId === iterationData.sessionId)) {
		return mission; // Already recorded for this session — skip.
	}

	const number = mission.currentIteration + 1;
	const iteration = {
		number,
		sessionId: iterationData.sessionId || null,
		findings: iterationData.findings || [],
		qualityScore: iterationData.qualityScore ?? null,
		verdict: iterationData.verdict || null,
		releaseReady: iterationData.releaseReady ?? null,
		improvementPrompt: iterationData.improvementPrompt || null,
		ranAt: Date.now(),
		status: 'completed'
	};

	mission.iterations.push(iteration);
	mission.currentIteration = number;
	mission.sessionId = iteration.sessionId;
	mission.findings = iteration.findings;
	mission.qualityScore = iteration.qualityScore;
	mission.verdict = iteration.verdict;
	mission.releaseReady = iteration.releaseReady;
	mission.improvementPrompt = iteration.improvementPrompt;
	mission.updatedAt = Date.now();

	scheduleSave();
	bus.emit('mission:iteration', { missionId: id, iteration });
	return mission;
}

/**
 * Returns the last two iterations for comparison, or null if < 2 exist.
 */
export function getComparisonIterations(id) {
	const mission = store.get(id);
	if (!mission || mission.iterations.length < 2) return null;
	const n = mission.iterations.length;
	return {
		previous: mission.iterations[n - 2],
		current: mission.iterations[n - 1]
	};
}

/* ── Project Backfill / Reassign (same pattern as findings.js) ──── */

export function reassignProjectId(fromId, toId) {
	let moved = 0;
	for (const mission of store.values()) {
		if (mission.projectId === fromId) {
			mission.projectId = toId;
			mission.updatedAt = Date.now();
			moved++;
		}
	}
	if (moved) scheduleSave();
	return moved;
}

export function backfillProjectId() {
	const defaultId = getDefaultProjectId();
	let count = 0;
	for (const mission of store.values()) {
		if (!mission.projectId) {
			mission.projectId = defaultId;
			count++;
		}
	}
	if (count) scheduleSave();
	return count;
}

/* ── Init ──────────────────────────────────────────────────────── */

export function loadMissionsFromDisk() {
	loadMissions();
	backfillProjectId();
}

export { bus as missionBus };
