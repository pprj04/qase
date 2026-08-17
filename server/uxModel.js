/**
 * Phase 17 — UX assessment model: dimensions, scoring, issues, review states.
 *
 * Pure functions over CheckResults produced by uxChecks.js + friction records
 * from uxFriction.js. Deterministic; no LLM anywhere in this module.
 *
 * Scoring model (documented in docs/UX_INTELLIGENCE_MODEL.md):
 *  - Each dimension starts at 100.
 *  - Each ISSUE check result deducts a severity weight: critical 25, high 15,
 *    medium 8, low 3 (aligned with the Phase 16 devIntelligence severity
 *    weights so scores are comparable).
 *  - Deduction is scaled by (1 - repetition dampening): repeated identical
 *    checkIds across pages/viewports count at sqrt scale — more occurrences
 *    hurt more, but not linearly.
 *  - Score floor 0.
 *  - Dimension confidence = evidenceCoverage × scope:
 *      coverage = decisive (PASS|ISSUE) checks / total checks
 *      scope    = pagesWithAnyData / pagesVisited (transport success)
 *  - UNVERIFIED checks never deduct and never raise confidence.
 */

import { CHECK_STATUS, runPageChecks } from './uxChecks.js';

export const UX_ISSUE_KINDS = Object.freeze({
	FUNCTIONAL_DEFECT: 'FUNCTIONAL_DEFECT',
	UX_ISSUE: 'UX_ISSUE',
	ACCESSIBILITY_ISSUE: 'ACCESSIBILITY_ISSUE',
	FEATURE_GAP: 'FEATURE_GAP',
	OBSERVATION: 'OBSERVATION',
	RECOMMENDATION: 'RECOMMENDATION',
});

export const REVIEW_STATES = Object.freeze({
	AUTO_VERIFIED: 'AUTO_VERIFIED',
	REVIEW_REQUIRED: 'REVIEW_REQUIRED',
	REJECTED: 'REJECTED',
});

/** Dimension checkIds that produce inherently subjective judgments → always REVIEW_REQUIRED when ISSUE. */
const SUBJECTIVE_DIMENSIONS = new Set(['CLARITY', 'CONSISTENCY']);

const SEVERITY_WEIGHTS = { critical: 25, high: 15, medium: 8, low: 3, info: 0.5, none: 0 };

/** How many occurrences turn into a deduction multiplier (sqrt dampening). */
function repetitionFactor(count) {
	if (count <= 0) return 0;
	if (count === 1) return 1;
	// 1 → 1.0, 4 → 2.0, 9 → 3.0 … capped at 3 so one noisy check can't zero a dimension.
	return Math.min(3, Math.sqrt(count));
}

/**
 * Aggregate check results per dimension.
 * Input: flat list of check results (mixed dimensions), each with
 * {checkId, dimension, status, severity, detail, evidence, viewport, url?}.
 * Output: per-dimension {score, confidence, coverage, decisive, unverified, issues}
 */
export function aggregateChecks(results, opts = {}) {
	const byDim = new Map();
	// Optional scope factor: pages with any collected data / pages attempted.
	// Supplied by uxAssessment from sweepMeta; defaults to 1 (unit tests).
	const scope = Number.isFinite(opts.scope) && opts.scope > 0 ? Math.min(1, opts.scope) : 1;
	for (const r of results) {
		if (!byDim.has(r.dimension)) byDim.set(r.dimension, { results: [], occurrences: new Map() });
		const d = byDim.get(r.dimension);
		d.results.push(r);
		if (r.status === CHECK_STATUS.ISSUE) {
			d.occurrences.set(r.checkId, (d.occurrences.get(r.checkId) ?? 0) + 1);
		}
	}
	const dims = [];
	for (const [dimension, d] of byDim) {
		let deduction = 0;
		for (const [checkId, count] of d.occurrences) {
			const sample = d.results.find(r => r.checkId === checkId && r.status === CHECK_STATUS.ISSUE);
			deduction += SEVERITY_WEIGHTS[sample.severity] * repetitionFactor(count);
		}
		const decisive = d.results.filter(r => r.status !== CHECK_STATUS.UNVERIFIED).length;
		const total = d.results.length;
		const coverage = total > 0 ? Number((decisive / total).toFixed(2)) : 0;
		// Model (docs/UX_INTELLIGENCE_MODEL.md §4.1): confidence = clamp(coverage × scope, 0.30, 0.95)
		// when any decisive data exists — 0 otherwise. Scope accounts for transport
		// failures during the sweep; coverage accounts for UNVERIFIED checks.
		const confidence = decisive > 0 ? Math.max(0.3, Math.min(0.95, Number((coverage * scope).toFixed(2)))) : 0;
		dims.push({
			dimension,
			score: Math.max(0, Math.round(100 - deduction)),
			confidence: Number(confidence.toFixed(2)),
			evidenceCoverage: Number(coverage.toFixed(2)),
			scope: Number(scope.toFixed(2)),
			decisive,
			unverified: total - decisive,
			occurrenceSummary: Object.fromEntries(d.occurrences),
		});
	}
	return dims;
}

/** Map an ISSUE check result to a UX issue kind. Deterministic by check family. */
function kindForCheck(checkId, dimension) {
	if (dimension === 'ACCESSIBILITY') return UX_ISSUE_KINDS.ACCESSIBILITY_ISSUE;
	if (dimension === 'RESPONSIVENESS') return UX_ISSUE_KINDS.UX_ISSUE;
	if (checkId === 'console_errors') return UX_ISSUE_KINDS.OBSERVATION; // console errors are surfaced facts, not UX verdicts by themselves
	return UX_ISSUE_KINDS.UX_ISSUE;
}

/**
 * Build UX issue records from check results (one per distinct checkId+url+viewport,
 * with occurrences grouped).
 * Every issue carries: kind, dimension, severity, confidence, evidence, reviewState.
 */
export function buildIssuesFromChecks(results, { pagesVisited = 0 } = {}) {
	const groups = new Map();
	for (const r of results) {
		if (r.status !== CHECK_STATUS.ISSUE) continue;
		const key = `${r.checkId}|${r.url ?? ''}`;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(r);
	}
	const issues = [];
	let n = 0;
	for (const [key, rs] of groups) {
		n++;
		const first = rs[0];
		const count = rs.length;
		// Issue confidence: strong with multiple occurrences or strong evidence kinds; never above 0.85 for UX judgments.
		const hasScreenshot = rs.some(r => (r.evidence || []).some(e => e.kind === 'screenshot'));
		const hasDom = rs.some(r => (r.evidence || []).some(e => e.kind === 'dom' || e.kind === 'probe'));
		let conf = 0.5;
		if (hasScreenshot && hasDom) conf = 0.85;
		else if (hasScreenshot || (hasDom && count >= 2)) conf = 0.75;
		else if (hasDom) conf = 0.65;
		conf = Math.min(0.85, conf + (count >= 3 ? 0.05 : 0));
		const dimension = first.dimension;
		const kind = kindForCheck(first.checkId, dimension);
		// Review state: subjective dimensions or low confidence require human eyes.
		let reviewState = REVIEW_STATES.AUTO_VERIFIED;
		if (SUBJECTIVE_DIMENSIONS.has(dimension)) reviewState = REVIEW_STATES.REVIEW_REQUIRED;
		else if (conf < 0.6) reviewState = REVIEW_STATES.REVIEW_REQUIRED;
		issues.push({
			id: `uxi_${n.toString(36).padStart(4, '0')}_${first.checkId.slice(0, 12)}`,
			kind,
			dimension,
			checkId: first.checkId,
			title: first.detail || first.checkId,
			severity: first.severity,
			occurrences: count,
			urls: [...new Set(rs.map(r => r.url).filter(Boolean))],
			viewports: [...new Set(rs.map(r => r.viewport?.label).filter(Boolean))],
			confidence: Number(conf.toFixed(2)),
			evidence: rs.flatMap(r => (r.evidence || []).map(e => ({ ...e, checkId: r.checkId, viewport: r.viewport?.label ?? null }))),
			expected: expectedForCheck(first.checkId),
			actual: first.detail,
			impact: impactForSeverity(first.severity, first.dimension),
			reviewState,
			status: 'VERIFIED',   // deterministically observed
		});
	}
	return issues;
}

/** Expected behavior text per check — NEVER invented; only what the check itself defines. */
const EXPECTED_TEXT = {
	nav_presence: 'Primary pages expose a navigation landmark or equivalent wayfinding',
	navigation_dead_end: 'Users can continue to other parts of the application from any page',
	navigation_broken_internal_links: 'Links navigate somewhere when clicked',
	clarity_document_title: 'Each page has a distinct, descriptive document title',
	clarity_page_heading: 'Each content page has exactly one top-level heading',
	consistency_cross_page: 'Navigation and page-title conventions are stable across pages',
	feedback_action_feedback: 'Long-running submissions show loading state; completed submissions report success or failure',
	error_experience: 'Errors are explained in plain language with a recovery path and without exposing technical detail',
	form_field_labels: 'Every form field has a label, aria-label, or descriptive placeholder',
	form_input_types: 'Field input types match the data being collected',
	form_required_marking: 'Required fields are marked',
	form_password_handling: 'Password fields declare autocomplete hints',
	hierarchy_heading_order: 'Heading levels increase without skipping',
	a11y_image_alt: 'Informative images have alt text',
	a11y_interactive_names: 'Interactive elements have accessible names',
	a11y_document_lang: 'Document declares its language',
	a11y_positive_tabindex: 'Tab order follows document order',
	a11y_heading_structure: 'A top-level heading exists',
	a11y_viewport_zoom: 'Pinch-zoom is not disabled',
	resp_horizontal_overflow: 'Content fits the viewport width at tablet and mobile sizes',
	resp_touch_targets: 'Touch targets on mobile meet minimum size',
	resp_clipped_text: 'Text is fully visible at constrained viewports',
	resp_viewport_meta: 'Mobile pages declare a responsive viewport meta tag',
	console_errors: 'No JavaScript console errors during normal interaction',
};

export function expectedForCheck(checkId) {
	return EXPECTED_TEXT[checkId] ?? null;   // null = uncertain expectation, must not be asserted
}

function impactForSeverity(sev, dim) {
	const scope = dim === 'ACCESSIBILITY' ? 'users relying on assistive technology' : 'users';
	switch (sev) {
		case 'critical': return `Blocks ${scope} from completing their goal`;
		case 'high': return `Significantly impedes ${scope}`;
		case 'medium': return `Adds friction for ${scope}`;
		case 'low': return `Minor annoyance for ${scope}`;
		default: return `Marginal effect on ${scope}`;
	}
}

/**
 * Human review transition. REJECTED is terminal from human action only;
 * AUTO_VERIFIED ↔ REVIEW_REQUIRED may be set by the system or human.
 */
export function transitionReviewState(current, next, by = 'system') {
	const valid = Object.values(REVIEW_STATES);
	if (!valid.includes(next)) throw new Error(`invalid review state: ${next}`);
	if (current === REVIEW_STATES.REJECTED && by === 'system') {
		throw new Error('REJECTED is a human-only state and cannot be left by system transitions');
	}
	return { reviewState: next, reviewedBy: by, reviewedAt: Date.now() };
}

/**
 * Full UX assessment assembly from sweep data.
 * sweep = { pages: {key: pageData}, siteResults, sweepMeta: {pagesVisited, viewports, okPages, failedPages} }
 */
export function buildUxAssessment(sweep) {
	const allResults = [];
	for (const [key, pd] of Object.entries(sweep.pages ?? {})) {
		const url = pd?.url ?? key;
		const results = runPageChecks(pd);
		for (const r of results) {
			allResults.push({ ...r, url });
		}
	}
	const siteResults = sweep.siteResults ?? [];
	// Scope factor: pages that yielded data / pages visited (docs §4.1).
	const meta = sweep.sweepMeta ?? {};
	const attempted = meta.pagesVisited ?? Object.keys(sweep.pages ?? {}).length;
	const withData = Object.values(sweep.pages ?? {}).filter(p => p && p.dataCollection?.ok).length;
	const scope = attempted > 0 ? Number((withData / attempted).toFixed(2)) : 1;
	const dimensionRows = aggregateChecks(
		[...allResults, ...siteResults.map(r => ({ ...r, url: '(site)' }))],
		{ scope }
	);

	const issues = buildIssuesFromChecks(allResults, { pagesVisited: sweep.sweepMeta?.pagesVisited ?? 0 });

	// Unverified areas — surfaced, never hidden.
	const unverifiedAreas = [...allResults, ...siteResults]
		.filter(r => r.status === CHECK_STATUS.UNVERIFIED)
		.map(r => ({ checkId: r.checkId, dimension: r.dimension, detail: r.detail, url: r.url ?? '(site)' }));

	const overallScore = dimensionRows.length > 0
		? Math.round(dimensionRows.reduce((s, d) => s + d.score, 0) / dimensionRows.length)
		: null;
	const overallConfidence = dimensionRows.length > 0
		? Number((dimensionRows.reduce((s, d) => s + d.confidence, 0) / dimensionRows.length).toFixed(2))
		: 0;

	return {
		modelVersion: 1,
		dimensions: dimensionRows,
		issues,
		unverifiedAreas,
		overall: {
			score: overallScore,
			confidence: overallConfidence,
			dimensionCount: dimensionRows.length,
			evidenceCoverage: dimensionRows.length > 0
				? Number((dimensionRows.reduce((s, d) => s + d.evidenceCoverage, 0) / dimensionRows.length).toFixed(2))
				: 0,
		},
	};
}

// runPageChecks is imported directly from uxChecks.js (no circular dependency).
