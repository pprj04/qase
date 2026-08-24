/**
 * Phase 17 — UX assessment store + orchestration.
 *
 * Owns `.qase/ux-assessments.json` (atomic write, same pattern as findings.js)
 * and the runUxAssessment orchestration:
 *
 *   sweep → checks → friction → feature-gap validation → recommendations
 *         → quality assessment → persist → evidence nodes → SSE/metrics
 *
 * Runs STRICTLY async after mission finalize (setImmediate by the caller).
 * Never throws to the caller; failures degrade to partial assessments with
 * unverified areas recorded.
 */

import { existsSync, readFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { atomicWrite } from './atomicWrite.js';
import { redactString } from './findingIntelligence.js';
import { runUxSweep, discoverPages } from './uxSweep.js';
import { runSiteChecks, CHECK_STATUS } from './uxChecks.js';
import { buildUxAssessment, transitionReviewState, REVIEW_STATES } from './uxModel.js';
import { analyzeFriction, frictionDimension } from './uxFriction.js';
import { validateFeatureGaps, featureCompleteness } from './featureGapValidation.js';
import { buildRecommendations } from './recommendationEngine.js';
import { buildQualityAssessment } from './qualityAssessment.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = join(__dirname, '..', '.qase', 'ux-assessments.json');
export const UX_ASSESSMENT_VERSION = 1;

/* ── store ───────────────────────────────────────────────────────── */

const assessments = new Map();

export function loadAssessments() {
	try {
		if (!existsSync(FILE)) return 0;
		const raw = readFileSync(FILE, 'utf8');
		const arr = JSON.parse(raw);
		if (!Array.isArray(arr)) return 0;
		for (const a of arr) assessments.set(a.id, a);
		return arr.length;
	} catch (err) {
		// M1-P4.4 Phase 5 — preserve damaged store for forensics, start empty.
		try {
			renameSync(FILE, `${FILE}.corrupt-${Date.now()}`);
			console.error(`[ux-assessments] STORE CORRUPT: ${err.message}. File preserved — starting EMPTY.`);
		} catch {
			console.error(`[ux-assessments] STORE CORRUPT: ${err.message} — starting EMPTY.`);
		}
		return 0;
	}
}

let saveTimer = null;
let pendingWrite = false;
function scheduleSave() {
	pendingWrite = true;
	if (saveTimer) return;
	saveTimer = setTimeout(() => {
		saveTimer = null;
		try {
			mkdirSync(dirname(FILE), { recursive: true });
			atomicWrite(FILE, JSON.stringify([...assessments.values()], null, 2));
			pendingWrite = false;
		} catch (err) {
			console.error('[ux-assessments] save failed:', err.message);
		}
	}, 400);
}

/**
 * M1-P4.4 Phase 2 — graceful shutdown flush. Idempotent.
 */
export function flushUxAssessmentsForShutdown() {
	if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
	if (!pendingWrite) return { dirty: false, ok: true };
	try {
		mkdirSync(dirname(FILE), { recursive: true });
		atomicWrite(FILE, JSON.stringify([...assessments.values()], null, 2));
		pendingWrite = false;
		return { dirty: true, ok: true };
	} catch (err) {
		return { dirty: true, ok: false, error: err.message };
	}
}

export function saveAssessment(record) {
	assessments.set(record.id, record);
	scheduleSave();
	return record;
}

/**
 * M1-P4.4 Phase 3 — retention prune: remove assessments by id (store-hygiene
 * cleanup). Returns the ids actually removed.
 */
export function pruneAssessmentsByIds(ids) {
	if (!Array.isArray(ids) || ids.length === 0) return [];
	const removed = [];
	for (const id of ids) {
		if (assessments.delete(id)) removed.push(id);
	}
	if (removed.length > 0) scheduleSave();
	return removed;
}

export function listAssessments({ missionId, sessionId, limit = 50, offset = 0 } = {}) {
	let rows = [...assessments.values()];
	if (missionId) rows = rows.filter((a) => a.missionId === missionId);
	if (sessionId) rows = rows.filter((a) => a.sessionId === sessionId);
	rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
	return rows.slice(offset, offset + limit);
}

export function getAssessmentForMission(missionId) {
	return listAssessments({ missionId, limit: 1 })[0] ?? null;
}

/** Human review PATCH — REJECTED is human-only; system cannot leave it. */
export function applyIssueReview(missionId, issueId, { reviewState, reason, by } = {}) {
	const a = getAssessmentForMission(missionId);
	if (!a) return { error: 'assessment_not_found' };
	const issues = a.ux?.issues ?? a.issues ?? [];
	const issue = issues.find((i) => i.id === issueId);
	if (!issue) return { error: 'issue_not_found' };
	try {
		const t = transitionReviewState(issue.reviewState, reviewState, by || 'human');
		issue.reviewState = t.reviewState;
		issue.reviewedBy = t.reviewedBy;
		issue.reviewedAt = t.reviewedAt;
		if (reason) issue.reviewReason = redactString(String(reason)).slice(0, 500);
		saveAssessment(a);
		return { assessment: a, issue };
	} catch (err) {
		return { error: 'invalid_transition', detail: err.message };
	}
}

/* ── helpers for orchestration ────────────────────────────────────── */

/**
 * Expected features with provenance. Only EXPLICIT sources
 * (user-provided requirements / expectedFeatures / buildPrompt) may confirm
 * a gap; heuristic/LLM-derived expectations can only produce POTENTIAL gaps.
 */
function buildExpectedFeaturesFromMission(mission) {
	const rows = [];
	const ctx = mission?.context ?? {};
	const raw = ctx.expectedFeatures;
	if (Array.isArray(raw) && raw.length > 0) {
		for (const f of raw) rows.push({ name: String(typeof f === 'string' ? f : f?.name ?? '').trim().slice(0, 200), source: 'explicit', provenanceConfidence: 1.0 });
	} else if (Array.isArray(ctx.requirements) && ctx.requirements.length > 0) {
		for (const r of ctx.requirements) rows.push({ name: String(typeof r === 'string' ? r : r?.feature ?? r?.name ?? '').trim().slice(0, 200), source: 'requirements', provenanceConfidence: 0.95 });
	}
	// Heuristic (domain-inferred) expectations: included but tier=heuristic.
	for (const f of mission?.context?.phase8?.expectedVsObserved?.features ?? []) {
		if (f.source === 'heuristic' || f.provenance === 'domain' || f.source === 'domain') {
			rows.push({ name: String(f.name).slice(0, 200), source: 'heuristic', provenanceConfidence: 0.4 });
		}
	}
	const seen = new Set();
	return rows.filter((r) => r.name && !seen.has(r.name.toLowerCase()) && seen.add(r.name.toLowerCase()));
}

/** Build workflow runs from phase8 workflowIntelligence (preferred) or capturedSteps. */
function buildWorkflowRuns(mission, session) {
	const runs = [];
	const wfI = mission?.context?.phase8?.workflowIntelligence;
	if (wfI?.workflows?.length) {
		for (const w of wfI.workflows) {
			runs.push({
				name: w.name,
				status: w.outcome === 'passed' ? 'pass' : w.outcome === 'failed' ? 'failed' : w.outcome === 'blocked' ? 'blocked' : 'not_tested',
				expectedSteps: typeof w.stepSummary?.expected === 'number' ? w.stepSummary.expected : undefined,
				urlStart: null,
				urlEnd: null,
				steps: (w.steps ?? []).map((s, i) => ({
					index: i + 1,
					action: s.name,
					description: s.name,
					target: null,
					status: s.outcome === 'failed' || s.outcome === 'blocked' ? s.outcome : 'pass',
					urlAfter: null,
					fieldsFilled: [],
					dialogAppeared: false,
				})),
			});
		}
		return runs;
	}
	// Fallback: one pseudo-workflow from the agent's captured steps.
	// Strings are re-redacted before persisting (defense in depth — the
	// session store should already be clean, but friction evidence is
	// second-order data we do not fully control).
	const steps = (session?.capturedSteps ?? []).map((s, i) => ({
		index: s.index ?? i + 1,
		action: redactString(String(s.action ?? '')),
		description: redactString(String(s.description ?? '')),
		target: redactString(String(s.target ?? '')),
		status: s.status === 'failed' || s.status === 'blocked' ? s.status : 'pass',
		urlAfter: redactString(String(s.urlAfter ?? s.url ?? '')),
		fieldsFilled: Array.isArray(s.fieldsFilled) ? s.fieldsFilled.map((f) => redactString(String(f))) : [],
		dialogAppeared: Boolean(s.dialogAppeared),
	}));
	if (steps.length > 0) {
		runs.push({ name: 'exploration', status: 'pass', steps, urlStart: steps[0]?.urlAfter ?? null, urlEnd: steps[steps.length - 1]?.urlAfter ?? null });
	}
	return runs;
}

function observationsFromSession(session, mission) {
	const evs = mission?.context?.phase8?.expectedVsObserved ?? null;
	const verified = [], broken = [];
	for (const f of evs?.features ?? []) {
		if (f.status === 'implemented') verified.push(f.name);
		else if (f.status === 'implemented_but_broken') broken.push(f.name);
	}
	const pageSet = new Set();
	for (const s of session?.capturedSteps ?? []) { if (s.url || s.urlAfter) pageSet.add(s.url || s.urlAfter); }
	for (const p of session?.appInventory?.pages ?? []) pageSet.add(typeof p === 'string' ? p : p?.url);
	const wfCoverage = mission?.context?.phase8?.workflowIntelligence?.coverage;
	return {
		verifiedFeatures: verified,
		brokenFeatures: broken,
		pagesObserved: pageSet.size,
		workflowsTested: wfCoverage?.tested ?? (session?.capturedSteps?.length ? 1 : 0),
		workflowsPassed: wfCoverage?.passed ?? 0,
		blockedWorkflows: wfCoverage?.blocked ?? 0,
		blockedWorkflowNames: (mission?.context?.phase8?.workflowIntelligence?.workflows ?? []).filter((w) => w.outcome === 'blocked').map((w) => w.name),
		explorationConfidence: session?.appModel?.observed?.explorationConfidence ?? session?.appInventory?.explorationConfidence ?? 0.2,
		positiveSignals: buildPositiveSignals(session),
	};
}

/** Inventory signals: forms/headings/buttons observed in the sweep inventory. */
function buildPositiveSignals(session) {
	const signals = [];
	try {
		for (const key of ['search', 'login', 'signup', 'contact', 'cart', 'settings', 'profile', 'dashboard', 'export', 'filter', 'notification', 'help']) {
			const hay = JSON.stringify(session?.appInventory ?? {}).toLowerCase();
			if (hay.includes(key)) signals.push({ feature: key, where: 'app inventory' });
		}
	} catch { /* best-effort */ }
	return signals.slice(0, 20);
}

/* ── metrics hook (spec: observability) ──────────────────────────── */

const uxMetrics = {
	assessmentsRun: 0,
	sweepFailures: 0,
	sweepDurationMsTotal: 0,
	assessmentLatencyMsTotal: 0,
	lastDurationMs: null,
};
export function getUxMetrics() { return { ...uxMetrics }; }

/* ── site-level result merge ─────────────────────────────────────── */

const SEVERITY_DEDUCTION = { low: 3, medium: 8, high: 15, critical: 25 };

function mergeSiteResults(assessment, siteResults) {
	for (const r of siteResults) {
		if (r.status === CHECK_STATUS.UNVERIFIED) {
			assessment.unverifiedAreas.push({ checkId: r.checkId, dimension: r.dimension, detail: r.detail, url: '(site)' });
			continue;
		}
		const row = assessment.dimensions.find((d) => d.dimension === r.dimension);
		if (row) {
			if (r.status === CHECK_STATUS.ISSUE) {
				row.score = Math.max(0, row.score - SEVERITY_DEDUCTION[r.severity] ?? 8);
				row.occurrenceSummary[r.checkId] = (row.occurrenceSummary[r.checkId] ?? 0) + 1;
				row.decisive += 1;
			} else {
				row.decisive += 1;
			}
			const total = row.decisive + row.unverified;
			row.evidenceCoverage = total > 0 ? Number((row.decisive / total).toFixed(2)) : row.evidenceCoverage;
		} else if (r.status === CHECK_STATUS.ISSUE) {
			assessment.dimensions.push({
				dimension: r.dimension,
				score: Math.max(0, 100 - (SEVERITY_DEDUCTION[r.severity] ?? 8)),
				confidence: 0.7,
				evidenceCoverage: 1,
				decisive: 1,
				unverified: 0,
				occurrenceSummary: { [r.checkId]: 1 },
			});
		}
		if (r.status === CHECK_STATUS.ISSUE) {
			assessment.issues.push({
				id: `uxi_site_${r.checkId}`,
				kind: 'UX_ISSUE',
				dimension: r.dimension,
				checkId: r.checkId,
				title: r.detail || r.checkId,
				severity: r.severity,
				occurrences: 1,
				urls: ['(site)'],
				viewports: [],
				confidence: Math.min(0.85, 0.5 + (r.evidence?.length ?? 0) * 0.1),
				evidence: r.evidence ?? [],
				expected: null,
				actual: r.detail,
				impact: 'Cross-page consistency is degraded',
				reviewState: REVIEW_STATES.REVIEW_REQUIRED,
				status: 'VERIFIED',
			});
		}
	}
	// Recompute overall after merges
	const dims = assessment.dimensions;
	if (dims.length > 0) {
		assessment.overall.score = Math.round(dims.reduce((s, d) => s + d.score, 0) / dims.length);
		assessment.overall.confidence = Number((dims.reduce((s, d) => s + d.confidence, 0) / dims.length).toFixed(2));
		assessment.overall.evidenceCoverage = Number((dims.reduce((s, d) => s + d.evidenceCoverage, 0) / dims.length).toFixed(2));
		assessment.overall.dimensionCount = dims.length;
	}
}

/* ── main orchestration ──────────────────────────────────────────── */

/**
 * Run the full UX assessment for a completed mission session.
 * NEVER throws — returns { ok, assessment, error }.
 */
export async function runUxAssessment(session, mission, opts = {}) {
	const startedAt = Date.now();
	const missionId = mission?.id ?? 'unknown-mission';
	const sessionId = session?.id ?? 'unknown-session';

	try {
		uxMetrics.assessmentsRun++;

		// 1. Discover pages from the session's own observations (no crawling)
		const pages = discoverPages(session);
		opts.onProgress?.('ux:sweep-start', { missionId, pages: pages.length });

		// 2. Deterministic sweep
		const sweep = await runUxSweep({ pages, timeoutMs: opts.sweepTimeoutMs });
		uxMetrics.sweepDurationMsTotal += sweep.sweepMeta.durationMs ?? 0;
		if (sweep.sweepMeta.error || sweep.sweepMeta.okPages === 0) uxMetrics.sweepFailures++;
		opts.onProgress?.('ux:sweep-done', {
			missionId,
			pagesVisited: sweep.sweepMeta.pagesVisited,
			okPages: sweep.sweepMeta.okPages,
			timedOut: sweep.sweepMeta.timedOut,
		});

		// 3. Page checks → ux model (dimensions, issues, unverified areas)
		const assessment = buildUxAssessment(sweep);

		// 3b. Site-level checks merged on top
		const siteResults = runSiteChecks(sweep.pages);
		mergeSiteResults(assessment, siteResults);

		// 4. Friction analysis from workflow intelligence / captured steps
		const workflowRuns = buildWorkflowRuns(mission, session);
		const friction = analyzeFriction(workflowRuns);
		if (workflowRuns.length > 0) {
			assessment.dimensions.push(frictionDimension(friction.frictionPoints));
		}

		// 5. Feature-gap validation (only EXPLICIT expectations may confirm)
		const expectedFeatures = buildExpectedFeaturesFromMission(mission);
		const observations = observationsFromSession(session, mission);
		const gapValidation = validateFeatureGaps(expectedFeatures, observations);
		const completeness = featureCompleteness(gapValidation);

		// 6. Recommendations (deterministic, evidence-linked)
		const recommendations = buildRecommendations({
			uxIssues: assessment.issues,
			frictionPoints: friction.frictionPoints,
			featureGaps: gapValidation.features.filter((f) => f.classification !== 'IMPLEMENTED'),
		});

		// 7. Quality assessment (weighted, uncertainty-preserving)
		const wfCoverage = mission?.context?.phase8?.workflowIntelligence?.coverage;
		const quality = buildQualityAssessment({
			functionalScore: typeof mission?.qualityScore === 'number' ? mission.qualityScore : null,
			uxDimensions: assessment.dimensions,
			completeness: completeness.score == null ? null : completeness,
			workflowOutcomes: wfCoverage ? { total: wfCoverage.total, passed: wfCoverage.passed, failed: wfCoverage.failed, blocked: wfCoverage.blocked } : null,
		});

		// 8. Persist
		const record = {
			id: `uxa_${randomUUID().slice(0, 12)}`,
			modelVersion: UX_ASSESSMENT_VERSION,
			missionId,
			sessionId,
			projectId: mission?.projectId ?? null,
			createdAt: Date.now(),
			durationMs: Date.now() - startedAt,
			sweepMeta: sweep.sweepMeta,
			ux: {
				dimensions: assessment.dimensions,
				issues: assessment.issues,
				unverifiedAreas: assessment.unverifiedAreas,
				overall: assessment.overall,
			},
			friction,
			featureGaps: gapValidation,
			recommendations,
			quality,
		};
		saveAssessment(record);

		uxMetrics.assessmentLatencyMsTotal += record.durationMs;
		uxMetrics.lastDurationMs = record.durationMs;
		opts.onProgress?.('ux:assessment-done', { missionId, assessmentId: record.id, score: quality.overall.score });

		return { ok: true, assessment: record, error: null };
	} catch (err) {
		uxMetrics.sweepFailures++;
		console.error(`[ux-assessment] Failed for mission ${missionId}:`, err?.message || err);
		return { ok: false, assessment: null, error: String(err?.message || err) };
	}
}
