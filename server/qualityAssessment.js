/**
 * Phase 17 — application quality assessment.
 *
 * EXTENDS the Phase 16 quality engine (devIntelligence.calculateMissionQuality)
 * — does NOT replace it. The functional score stays the Phase 16 severity-weighted
 * number; Phase 17 adds UX-side dimensions and a weighted overall.
 *
 * Dimensions (documented in docs/QUALITY_ASSESSMENT_MODEL.md):
 *   FUNCTIONAL            — from calculateMissionQuality (unchanged input)
 *   UX                    — weighted mean of the 9 uxModel dimensions
 *   ACCESSIBILITY         — from uxModel ACCESSIBILITY dimension
 *   FEATURE_COMPLETENESS  — from featureGapValidation.featureCompleteness
 *   NAVIGATION            — from uxModel NAVIGATION dimension
 *   ERROR_HANDLING        — from uxModel ERROR_HANDLING dimension
 *   WORKFLOW_RELIABILITY  — from workflowEngine outcomes (pass/fail/blocked ratio)
 *
 * Every dimension carries score / confidence / evidenceCoverage. A dimension
 * with no data yields score=null, confidence=0 and is EXCLUDED from the overall
 * mean (never guessed).
 */

export const QUALITY_DIMENSIONS = Object.freeze([
	'FUNCTIONAL',
	'UX',
	'ACCESSIBILITY',
	'FEATURE_COMPLETENESS',
	'NAVIGATION',
	'ERROR_HANDLING',
	'WORKFLOW_RELIABILITY',
]);

/** Weights for the overall score (sum normalized internally). */
export const DIMENSION_WEIGHTS = Object.freeze({
	FUNCTIONAL: 3,
	UX: 3,
	ACCESSIBILITY: 1.5,
	FEATURE_COMPLETENESS: 2,
	NAVIGATION: 1,
	ERROR_HANDLING: 1,
	WORKFLOW_RELIABILITY: 2,
});

/**
 * Assemble the application quality assessment.
 *
 * inputs:
 *  - functionalScore: number|null (Phase 16 calculateMissionQuality score)
 *  - functionalConfidence: number (defaults 0.8 when a score exists)
 *  - uxDimensions: output of uxModel.aggregateChecks (+ frictionDimension row)
 *  - completeness: featureGapValidation.featureCompleteness output
 *  - workflowOutcomes: { total, passed, failed, blocked } counts
 */
export function buildQualityAssessment({
	functionalScore = null,
	functionalConfidence = 0.8,
	uxDimensions = [],
	completeness = null,
	workflowOutcomes = null,
} = {}) {
	const rows = [];

	// FUNCTIONAL
	if (typeof functionalScore === 'number') {
		rows.push(dim('FUNCTIONAL', functionalScore, functionalConfidence, 1.0, 'phase16 calculateMissionQuality'));
	}

	// UX — weighted mean of non-friction ux dimensions (friction is its own input too)
	const uxRows = uxDimensions.filter(d => d.dimension !== 'USER_FLOW_FRICTION' && d.dimension !== 'ACCESSIBILITY');
	if (uxRows.length > 0) {
		rows.push(aggregateDim('UX', uxRows));
	}

	// ACCESSIBILITY directly
	const a11y = uxDimensions.find(d => d.dimension === 'ACCESSIBILITY');
	if (a11y) rows.push(dim('ACCESSIBILITY', a11y.score, a11y.confidence, a11y.evidenceCoverage, 'ux sweep'));

	// FEATURE_COMPLETENESS
	if (completeness && typeof completeness.score === 'number') {
		rows.push(dim('FEATURE_COMPLETENESS', completeness.score, completeness.confidence, completeness.coverage ?? 0.8, 'feature gap validation'));
	}

	// NAVIGATION directly
	const nav = uxDimensions.find(d => d.dimension === 'NAVIGATION');
	if (nav) rows.push(dim('NAVIGATION', nav.score, nav.confidence, nav.evidenceCoverage, 'ux sweep'));

	// ERROR_HANDLING directly
	const err = uxDimensions.find(d => d.dimension === 'ERROR_HANDLING');
	if (err) rows.push(dim('ERROR_HANDLING', err.score, err.confidence, err.evidenceCoverage, 'ux sweep'));

	// WORKFLOW_RELIABILITY
	if (workflowOutcomes && (workflowOutcomes.total ?? 0) > 0) {
		const { total = 0, passed = 0, blocked = 0 } = workflowOutcomes;
		const score = Math.round((passed / total) * 100);
		const confidence = total >= 3 ? 0.85 : 0.6;
		rows.push(dim('WORKFLOW_RELIABILITY', score, confidence, 1.0, `${passed}/${total} workflows passed, ${blocked} blocked`));
	}

	// Overall — weighted mean over dimensions WITH data.
	const scored = rows.filter(r => r.score != null);
	let overall = null, overallConfidence = 0, overallCoverage = 0;
	if (scored.length > 0) {
		let wSum = 0, sSum = 0, cSum = 0, covSum = 0;
		for (const r of scored) {
			const w = DIMENSION_WEIGHTS[r.dimension] ?? 1;
			wSum += w;
			sSum += w * r.score;
			cSum += w * r.confidence;
			covSum += w * r.evidenceCoverage;
		}
		overall = Math.round(sSum / wSum);
		overallConfidence = Number((cSum / wSum).toFixed(2));
		overallCoverage = Number((covSum / wSum).toFixed(2));
	}

	return {
		modelVersion: 1,
		dimensions: rows,
		overall: {
			score: overall,
			confidence: overallConfidence,
			evidenceCoverage: overallCoverage,
			dimensionsScored: scored.length,
			dimensionsMissing: QUALITY_DIMENSIONS.filter(d => !scored.some(r => r.dimension === d)),
		},
	};
}

function dim(dimension, score, confidence, evidenceCoverage, basis) {
	return {
		dimension, score: score == null ? null : Math.round(score),
		confidence: Number(confidence ?? 0),
		evidenceCoverage: Number(evidenceCoverage ?? 0),
		basis,
	};
}

function aggregateDim(dimension, rows) {
	if (rows.length === 0) return dim(dimension, null, 0, 0, 'no data');
	const score = rows.reduce((s, r) => s + (r.score ?? 0), 0) / rows.length;
	const confidence = rows.reduce((s, r) => s + (r.confidence ?? 0), 0) / rows.length;
	const coverage = rows.reduce((s, r) => s + (r.evidenceCoverage ?? 0), 0) / rows.length;
	return dim(dimension, score, confidence, coverage, `mean of ${rows.length} ux dimensions`);
}
