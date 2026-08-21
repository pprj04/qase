/**
 * Phase 18 — Fix Validation store + lifecycle + review + knowledge gating.
 * Owns .qase/fix-validations.json. Additive, separate from findings (invariant 1).
 * Pattern follows the Phase 17 ux-assessments store.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
	FIX_STATUSES,
	VALIDATION_RUN_STATUSES,
	VALIDATION_REVIEW_STATES,
	canTransitionReview,
	isTrustworthyForKnowledge,
} from './fixStatusEngine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(here, '..', '.qase', 'fix-validations.json');

const MAX_RUNS = 500;

let runs = [];
let writeTimer = null;

/** Finding resolver — wired by index.js to break the import cycle. */
let getFindingRef = null;
export function setFindingResolver(fn) { getFindingRef = typeof fn === 'function' ? fn : null; }

export function loadValidations() {
	try {
		const raw = fs.readFileSync(STORE_PATH, 'utf8');
		const parsed = JSON.parse(raw);
		runs = Array.isArray(parsed) ? parsed : [];
	} catch {
		runs = [];
	}
	return runs.length;
}

function persistNow() {
	try {
		fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
		const keep = runs.slice(0, MAX_RUNS);
		fs.writeFileSync(STORE_PATH, JSON.stringify(keep, null, 1));
	} catch (err) {
		console.error('[phase18] persist failed:', err.message);
	}
}

function persistSoon() {
	if (writeTimer) clearTimeout(writeTimer);
	writeTimer = setTimeout(persistNow, 250);
	writeTimer.unref?.();
}

export function saveRun(run) {
	const idx = runs.findIndex(r => r.id === run.id);
	if (idx >= 0) runs[idx] = run;
	else runs.unshift(run);
	if (runs.length > MAX_RUNS) runs.length = MAX_RUNS;
	persistSoon();
	return run;
}

export function getRun(id) {
	return runs.find(r => r.id === id) || null;
}

export function getRunsForFinding(findingId) {
	return runs
		.filter(r => r.findingId === findingId)
		.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function findByIdempotencyKey(key) {
	if (!key) return null;
	return runs.find(r => r.idempotencyKey === key && key) || null;
}

export function listValidations({ status, fixStatus, limit = 50 } = {}) {
	let out = runs;
	if (status) out = out.filter(r => r.status === status);
	if (fixStatus) out = out.filter(r => r.fixStatus === fixStatus);
	return out.slice(0, limit);
}

/**
 * Create a validation run record (status REQUESTED). The original finding is
 * SNAPSHOTTED immutably into run.originalFinding (invariant 1) — later finding
 * edits never rewrite history here.
 */
export function createRun({ finding, plan, requestedBy = 'api', idempotencyKey = null, trigger = 'manual' }) {
	if (!finding?.id) throw new Error('finding required');
	const now = Date.now();
	const run = {
		id: `fxv_${randomUUID().slice(0, 13)}`,
		createdAt: now,
		updatedAt: now,
		status: VALIDATION_RUN_STATUSES.REQUESTED,
		findingId: finding.id,
		missionId: finding.missionId || null,
		projectId: finding.projectId || null,
		requestedBy,
		trigger,
		idempotencyKey,
		// Immutable snapshot of the original finding (historical evidence).
		originalFinding: snapshotFinding(finding),
		// Same-condition plan (spec §4/§5).
		plan: {
			url: plan?.url ?? finding.url ?? null,
			viewport: plan?.viewport ?? null,
			device: plan?.device ?? null,
			browser: plan?.browser ?? null,
			workflowId: plan?.workflowId ?? finding.workflowId ?? null,
			featureId: plan?.featureId ?? finding.featureId ?? null,
			steps: plan?.steps ?? (Array.isArray(finding.steps) ? [...finding.steps] : []),
			expected: plan?.expected ?? finding.expected ?? null,
			credentialsUsed: plan?.credentialsUsed ?? false,
			regressionScope: plan?.regressionScope ?? [],
		},
		environmentDeltas: [],
		attempts: [],
		fixStatus: null,
		fixStatusReason: null,
		validationConfidence: null,
		confidenceSignals: null,
		partialFix: null,
		regressions: null,
		evidence: { before: [], after: [] },
		comparison: null,
		reviewState: VALIDATION_REVIEW_STATES.REVIEW_REQUIRED,
		reviewTrail: [],
		knowledgeUpdated: false,
		completedAt: null,
		error: null,
		timings: {},
	};
	saveRun(run);
	return run;
}

function snapshotFinding(f) {
	return {
		id: f.id,
		title: f.title,
		category: f.category ?? f.primaryCategory ?? null,
		severity: f.severity,
		priority: f.priority ?? null,
		confidence: f.confidence ?? null,
		expected: f.expected ?? null,
		actual: f.actual ?? null,
		steps: Array.isArray(f.steps) ? [...f.steps] : [],
		evidence: Array.isArray(f.evidence) ? f.evidence.map(e => ({ ...e })) : [],
		reproductionSteps: Array.isArray(f.reproductionSteps) ? [...f.reproductionSteps] : [],
		workflowId: f.workflowId ?? null,
		featureId: f.featureId ?? null,
		sessionId: f.sessionId ?? null,
		missionId: f.missionId ?? null,
		url: f.url ?? null,
		viewport: f.viewport ?? null,
		device: f.device ?? null,
		reproductionAttempts: f.reproductionAttempts ?? 0,
		reproductionSuccesses: f.reproductionSuccesses ?? 0,
		createdAt: f.ts ?? f.createdAt ?? null,
		snapshotNote: 'immutable original (Phase 18 invariant 1)',
	};
}

export function transitionRun(id, patch, reason = null) {
	const run = getRun(id);
	if (!run) return null;
	Object.assign(run, patch, { updatedAt: Date.now() });
	if (reason) run.statusReason = reason;
	saveRun(run);
	return run;
}

/** Append an attempt record (executor calls per attempt). */
export function appendAttempt(id, attempt) {
	const run = getRun(id);
	if (!run) return null;
	run.attempts.push({ ts: Date.now(), ...attempt });
	run.updatedAt = Date.now();
	saveRun(run);
	return run;
}

/**
 * Record the FINAL derived outcome. fixStatus/confidence come from
 * fixStatusEngine (never from an LLM). Also gates knowledge updates.
 * knowledgeWriter: (run) => void — provided by the executor wiring.
 */
export function completeRun(id, { fixStatus, fixStatusReason, validationConfidence, confidenceSignals, partialFix, regressions, comparison, timings, executedOn, executionEnvironment }, knowledgeWriter) {
	const run = getRun(id);
	if (!run) return null;
	run.status = VALIDATION_RUN_STATUSES.COMPLETED;
	run.fixStatus = fixStatus;
	run.fixStatusReason = fixStatusReason ?? null;
	run.validationConfidence = validationConfidence ?? null;
	run.confidenceSignals = confidenceSignals ?? null;
	run.partialFix = partialFix ?? null;
	run.regressions = regressions ?? null;
	run.comparison = comparison ?? null;
	run.timings = timings ?? {};
	// B0.2 — truthful execution provenance on the run itself. Additive; older
	// runs without these fields stay null/absent (never backfilled, never faked).
	run.executedOn = executedOn ?? run.executedOn ?? run.completedAt;
	run.executionEnvironment = executionEnvironment ?? run.executionEnvironment ?? null;
	run.completedAt = Date.now();
	run.updatedAt = run.completedAt;
	// Additive pointer fields on the finding (spec: results never merged into
	// the finding EXCEPT these). Applied by the store so every completion path
	// stays consistent; updateFinding ignores unknown keys by design.
	try {
		const f = typeof getFindingRef === 'function' ? getFindingRef(run.findingId) : null;
		if (f) {
			f.fixStatus = fixStatus ?? f.fixStatus ?? null;
			f.validationCount = (typeof f.validationCount === 'number' ? f.validationCount : 0) + 1;
			f.lastValidationId = run.id;
		}
	} catch { /* pointer fields are best-effort; runs remain the source of truth */ }
	// Knowledge gating (invariant 8): only trustworthy, confident outcomes persist.
	if (isTrustworthyForKnowledge(fixStatus, validationConfidence) && typeof knowledgeWriter === 'function') {
		try {
			knowledgeWriter(run);
			run.knowledgeUpdated = true;
		} catch (err) {
			console.error('[phase18] knowledge write failed:', err.message);
			run.knowledgeUpdated = false;
		}
	}
	saveRun(run);
	return run;
}

export function failRun(id, error) {
	const run = getRun(id);
	if (!run) return null;
	run.status = VALIDATION_RUN_STATUSES.FAILED;
	run.error = String(error || 'unknown').slice(0, 300);
	run.completedAt = Date.now();
	run.updatedAt = run.completedAt;
	saveRun(run);
	return run;
}

/** Human review transition with trail. by='human' required for closure states. */
export function applyReview(id, { to, by, comment = null }) {
	const run = getRun(id);
	if (!run) return { error: 'not_found' };
	if (!Object.values(VALIDATION_REVIEW_STATES).includes(to)) return { error: 'invalid_state' };
	if (!canTransitionReview(run.reviewState, to)) return { error: 'invalid_transition', from: run.reviewState, to };
	// Closure states are human-only by construction (API layer enforces identity).
	run.reviewState = to;
	run.reviewTrail.push({ to, by, comment, ts: Date.now() });
	run.updatedAt = Date.now();
	saveRun(run);
	return { run };
}

/** Comparison payload for the UI (structured before/after). */
export function getComparisonForFinding(findingId) {
	const done = getRunsForFinding(findingId).filter(r => r.status === VALIDATION_RUN_STATUSES.COMPLETED);
	if (done.length === 0) return null;
	const latest = done[0];
	return {
		findingId,
		validationId: latest.id,
		before: latest.evidence.before,
		after: latest.evidence.after,
		comparison: latest.comparison,
		fixStatus: latest.fixStatus,
		validationConfidence: latest.validationConfidence,
		attempts: {
			total: latest.attempts.length,
			successful: latest.attempts.filter(a => a.succeeded).length,
		},
	};
}

export function getFixValidationMetrics() {
	const completed = runs.filter(r => r.status === 'COMPLETED');
	const byFix = {};
	for (const r of completed) byFix[r.fixStatus] = (byFix[r.fixStatus] || 0) + 1;
	const durations = completed.filter(r => r.completedAt && r.createdAt).map(r => r.completedAt - r.createdAt);
	const avgMs = durations.length ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : null;
	return {
		totalRuns: runs.length,
		byStatus: countBy(runs, r => r.status),
		byFixStatus: byFix,
		knowledgeUpdates: runs.filter(r => r.knowledgeUpdated).length,
		avgDurationMs: avgMs,
	};
}

function countBy(list, fn) {
	const out = {};
	for (const item of list) {
		const k = fn(item) ?? 'unknown';
		out[k] = (out[k] || 0) + 1;
	}
	return out;
}

// Boot load
loadValidations();
