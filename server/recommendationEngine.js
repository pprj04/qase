/**
 * Phase 17 — deterministic recommendation engine.
 *
 * Recommendations are derived ONLY from validated UX issues, friction points,
 * and confirmed/potential feature gaps. Every recommendation references the
 * underlying record and its evidence — no free-floating advice, no LLM.
 *
 * Priority (P0–P3) is computed by a documented formula:
 *
 *   base(severity):   critical 100, high 70, medium 40, low 15
 *   priorityScore  =  base
 *                   + 20 × workflowCriticality (workflow named & friction/dead-end present)
 *                   + 15 × userImpact    (dimension in {NAVIGATION, FORM_USABILITY, ERROR_HANDLING, FEEDBACK})
 *                   + 10 × repetitionBonus (occurrences >= 3)
 *                   × confidence         (recommendations with weak evidence cannot reach P0/P1)
 *
 *   P0 ≥ 85   P1 ≥ 60   P2 ≥ 35   P3 < 35     (after confidence scaling, capped 100)
 *
 * A recommendation with confidence < 0.5 is always at least P3 — the engine
 * will not push uncertain fixes to the top of the list.
 */

export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];

const BASE = { critical: 100, high: 70, medium: 40, low: 15, info: 5, none: 0 };
const HIGH_IMPACT_DIMENSIONS = new Set(['NAVIGATION', 'FORM_USABILITY', 'ERROR_HANDLING', 'FEEDBACK', 'USER_FLOW_FRICTION']);

/** Recommendation templates — deterministic mapping from issue type to advice. */
const TEMPLATES = {
	nav_presence: 'Add a navigation landmark (<nav>) or consistent wayfinding to this page so users can orient themselves.',
	navigation_dead_end: 'Provide onward navigation from this page — a back link, breadcrumb, or return-to-dashboard action.',
	navigation_broken_internal_links: 'Repair or remove links with empty href attributes; they silently do nothing when clicked.',
	clarity_document_title: 'Give each page a distinct, descriptive <title> so tabs, history, and screen readers can distinguish pages.',
	clarity_page_heading: 'Use exactly one top-level <h1> per page stating the page purpose.',
	consistency_cross_page: 'Align navigation structure and page-title conventions across pages so recurring elements appear in the same place.',
	feedback_action_feedback: 'Add explicit success/failure feedback after form submission (and a loading indicator for operations over ~1s) so users know the outcome.',
	error_experience: 'Rewrite the error message in plain language: state what failed, why, and the recovery step; hide stack traces and internal errors.',
	form_field_labels: 'Associate every input with a <label> (or aria-label) so users and assistive tech know what to enter.',
	form_input_types: 'Use semantic input types (email/tel/number) so mobile keyboards and built-in validation match the data.',
	form_required_marking: 'Mark required fields explicitly (asterisk + text or required attribute) before submission fails.',
	form_password_handling: 'Add autocomplete="current-password"/"new-password" to password fields to enable password managers.',
	hierarchy_heading_order: 'Fix heading level skips so the document outline is machine-readable.',
	a11y_image_alt: 'Add alt text to informative images (empty alt for decorative ones).',
	a11y_interactive_names: 'Give every interactive element an accessible name (text content, aria-label, or aria-labelledby).',
	a11y_document_lang: 'Set <html lang="…"> so screen readers pick the right voice.',
	a11y_positive_tabindex: 'Remove positive tabindex values; rely on DOM order for tab sequence.',
	a11y_heading_structure: 'Add an <h1> to give assistive-technology users a page anchor.',
	a11y_viewport_zoom: 'Remove user-scalable=no / maximum-scale limits so low-vision users can zoom.',
	resp_horizontal_overflow: 'Fix the layout so content fits the viewport width (the flagged elements overflow on mobile).',
	resp_touch_targets: 'Enlarge tap targets to at least 24×24px (ideally 44×44px) on touch viewports.',
	resp_clipped_text: 'Fix clipped/truncated text at constrained viewports (allow wrapping or responsive typography).',
	resp_viewport_meta: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> for mobile rendering.',
	console_errors: 'Investigate the console errors observed during interaction — they may degrade functionality silently.',
};

const FRICTION_TEMPLATES = {
	EXCESSIVE_STEPS: 'Shorten this workflow — the observed path is far longer than the expected steps.',
	REPEATED_ENTRY: 'Eliminate re-entry of the same data within the workflow (carry values forward or persist drafts).',
	RETRY_LOOP: 'Make the failing step recoverable in place so users do not have to blindly retry.',
	MISSING_CONFIRMATION: 'Add a confirmation dialog before destructive actions in this workflow.',
	DEAD_END: 'Resolve the blocked path or provide an alternate route so users are not stuck.',
	UNCLEAR_NEXT_ACTION: 'Make the workflow outcome visible — navigate to the result or confirm completion in place.',
};

/**
 * Build recommendations from a ux assessment (issues + friction + feature gaps).
 */
export function buildRecommendations({ uxIssues = [], frictionPoints = [], featureGaps = [] } = {}) {
	const recs = [];

	for (const issue of uxIssues) {
		if (issue.reviewState === 'REJECTED') continue;
		const advice = TEMPLATES[issue.checkId];
		if (!advice) continue;
		recs.push(mkRec({
			refType: 'ux_issue',
			refId: issue.id,
			issueTitle: issue.title,
			impact: issue.impact,
			recommendation: advice,
			severity: issue.severity,
			confidence: issue.confidence,
			workflow: issue.workflow ?? null,
			dimension: issue.dimension,
			occurrences: issue.occurrences ?? 1,
			evidence: issue.evidence,
		}));
	}

	for (const fp of frictionPoints) {
		const advice = FRICTION_TEMPLATES[fp.type];
		if (!advice) continue;
		recs.push(mkRec({
			refType: 'friction',
			refId: fp.id,
			issueTitle: `${fp.workflow}: ${fp.detail}`,
			impact: `Adds friction to the "${fp.workflow}" workflow`,
			recommendation: advice,
			severity: fp.severity,
			confidence: fp.confidence,
			workflow: fp.workflow,
			dimension: 'USER_FLOW_FRICTION',
			occurrences: 1,
			evidence: fp.evidence,
		}));
	}

	for (const gap of featureGaps) {
		if (gap.classification === 'IMPLEMENTED') continue;
		const isConfirmed = gap.gapAssertion === 'CONFIRMED_FEATURE_GAP';
		recs.push(mkRec({
			refType: 'feature_gap',
			refId: gap.feature,
			issueTitle: `Feature gap: ${gap.feature}`,
			impact: isConfirmed
				? `Explicitly required feature "${gap.feature}" is missing`
				: `Possible missing feature "${gap.feature}" (${gap.classification})`,
			recommendation: isConfirmed
				? `Implement the required feature "${gap.feature}" or renegotiate the requirement — it is expected but not present.`
				: `Manually verify whether "${gap.feature}" exists; automated exploration could not ${gap.classification === 'UNVERIFIED' ? 'sufficiently explore' : 'confirm'} it.`,
			severity: isConfirmed ? 'high' : 'low',
			confidence: gap.confidence,
			workflow: null,
			dimension: 'FEATURE_COMPLETENESS',
			occurrences: 1,
			evidence: gap.evidence,
		}));
	}

	// Sort: priority score desc, then confidence desc.
	recs.sort((a, b) => b.priorityScore - a.priorityScore || b.confidence - a.confidence);
	return recs;
}

function mkRec({ refType, refId, issueTitle, impact, recommendation, severity, confidence, workflow, dimension, occurrences, evidence }) {
	const priorityScore = computePriorityScore({ severity, confidence, workflow, dimension, occurrences });
	return {
		id: `rec_${refType}_${String(refId).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40)}`,
		refType,
		refId,
		issueTitle,
		impact,
		recommendation,
		priority: priorityFromScore(priorityScore),
		priorityScore,
		severity,
		confidence,
		workflow,
		dimension,
		evidence: evidence ?? [],
	};
}

export function computePriorityScore({ severity, confidence, workflow, dimension, occurrences }) {
	let score = BASE[severity] ?? 0;
	if (workflow) score += 20;                                      // workflowCriticality
	if (dimension && HIGH_IMPACT_DIMENSIONS.has(dimension)) score += 15; // userImpact
	if ((occurrences ?? 1) >= 3) score += 10;                       // frequency
	score = score * Math.max(0, Math.min(1, confidence ?? 0));      // confidence scaling
	if ((confidence ?? 0) < 0.5) score = Math.min(score, 30);       // uncertain → never above P2 line
	return Math.round(Math.min(100, score));
}

function priorityFromScore(score) {
	if (score >= 85) return 'P0';
	if (score >= 60) return 'P1';
	if (score >= 35) return 'P2';
	return 'P3';
}
