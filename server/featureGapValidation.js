/**
 * Phase 17 — feature-gap validation.
 *
 * Gates the existing expectedVsObserved/featureGap output so a "missing
 * feature" claim is only asserted when:
 *   (a) the expectation is EXPLICIT (user-provided requirements / named
 *       expectedFeatures) — heuristic/LLM-sourced expectations can never
 *       confirm a gap, only suggest one;
 *   (b) exploration was sufficient (coverage gate);
 *   (c) no positive evidence of the feature was observed anywhere
 *       (inventory, workflows, pages, forms).
 *
 * Output classification per expected feature:
 *   IMPLEMENTED | PARTIALLY_IMPLEMENTED | NOT_FOUND | BLOCKED | UNVERIFIED
 * (vocabulary aligned with expectedVsObserved.FEATURE_STATUS).
 *
 * GAP_ASSERTION levels: POTENTIAL_FEATURE_GAP | CONFIRMED_FEATURE_GAP —
 * CONFIRMED requires explicit expectation + sufficient exploration + zero
 * positive observations. Never "CONFIRMED_MISSING_FEATURE" otherwise.
 */

export const GAP_CLASSIFICATION = Object.freeze({
	IMPLEMENTED: 'IMPLEMENTED',
	PARTIALLY_IMPLEMENTED: 'PARTIALLY_IMPLEMENTED',
	NOT_FOUND: 'NOT_FOUND',
	BLOCKED: 'BLOCKED',
	UNVERIFIED: 'UNVERIFIED',
});

export const GAP_ASSERTION = Object.freeze({
	POTENTIAL: 'POTENTIAL_FEATURE_GAP',
	CONFIRMED: 'CONFIRMED_FEATURE_GAP',
	NONE: null,
});

/** Provenance tiers — only EXPLICIT sources may confirm a gap. */
export const EXPECTATION_SOURCES = Object.freeze({
	EXPLICIT: 'explicit',           // user requirements / expectedFeatures list / buildPrompt named feature
	HEURISTIC: 'heuristic',         // domain catalog / app-type inference
	LLM: 'llm',                     // model-suggested
});

const EXPLICIT_THRESHOLD = 0.85;   // intentModel provenance confidences: rawExpected 1.0, requirements 0.95, buildPrompt 0.9, objectives 0.75

/** Exploration sufficiency gates (documented in docs/FEATURE_GAP_MODEL.md). */
export const EXPLORATION_GATES = Object.freeze({
	MIN_PAGES: 3,                    // unique pages observed
	MIN_WORKFLOWS_TESTED: 1,         // workflows actually executed
	MIN_EXPLORATION_CONFIDENCE: 0.3, // appModel.observed.explorationConfidence
});

/**
 * Validate a set of expected features against observations.
 *
 * expectedFeatures: [{ name, source, provenanceConfidence? }]   (normalized from intentModel/appModel)
 * observations: {
 *   verifiedFeatures: [string], brokenFeatures: [string], unverifiedFeatures?: [string],
 *   pagesObserved: number, workflowsTested: number, workflowsPassed: number,
 *   blockedWorkflows: number, explorationConfidence: number,
 *   positiveSignals?: [{ feature, where }]   // inventory/DOM/form matches
 * }
 */
export function validateFeatureGaps(expectedFeatures, observations) {
	const out = [];
	const sufficiency = assessExplorationSufficiency(observations);

	for (const ef of expectedFeatures ?? []) {
		const name = String(ef?.name ?? '').trim();
		if (!name) continue;
		const source = classifySource(ef);
		const positive = matchPositive(name, observations);

		// BLOCKED: workflows that would exercise the feature are blocked
		if (positive.blocked) {
			out.push(row(name, source, GAP_CLASSIFICATION.BLOCKED, GAP_ASSERTION.NONE, sufficiency,
				`Cannot assess "${name}": the workflow that exercises it was blocked`, positive.evidence, 0.4));
			continue;
		}

		if (positive.implemented) {
			out.push(row(name, source, GAP_CLASSIFICATION.IMPLEMENTED, GAP_ASSERTION.NONE, sufficiency,
				`Feature "${name}" observed working`, positive.evidence, 0.9));
			continue;
		}

		if (positive.broken) {
			out.push(row(name, source, GAP_CLASSIFICATION.IMPLEMENTED, GAP_ASSERTION.NONE, sufficiency,
				`Feature "${name}" exists but is broken (functional defect — see findings)`, positive.evidence, 0.85));
			continue;
		}

		if (positive.partial) {
			out.push(row(name, source, GAP_CLASSIFICATION.PARTIALLY_IMPLEMENTED, GAP_ASSERTION.NONE, sufficiency,
				`Feature "${name}" partially observed (${positive.partialDetail})`, positive.evidence, 0.7));
			continue;
		}

		// No positive signal at all. Now the gates decide.
		if (!sufficiency.sufficient) {
			out.push(row(name, source, GAP_CLASSIFICATION.UNVERIFIED, GAP_ASSERTION.POTENTIAL, sufficiency,
				`"${name}" not observed, but exploration was insufficient (${sufficiency.reason}) — cannot assert a gap`,
				[{ kind: 'coverage', detail: sufficiency.reason }], 0.3));
			continue;
		}

		if (source.tier !== EXPECTATION_SOURCES.EXPLICIT) {
			out.push(row(name, source, GAP_CLASSIFICATION.NOT_FOUND, GAP_ASSERTION.POTENTIAL, sufficiency,
				`"${name}" not observed anywhere; expectation is ${source.tier}-sourced — potential gap, human confirmation required`,
				[{ kind: 'inventory', detail: 'no positive signal in inventory, workflows, pages, or forms' }], 0.5));
			continue;
		}

		out.push(row(name, source, GAP_CLASSIFICATION.NOT_FOUND, GAP_ASSERTION.CONFIRMED, sufficiency,
			`"${name}" (explicit requirement) not observed in ${observations.pagesObserved} pages / ${observations.workflowsTested} workflow runs`,
			[
				{ kind: 'inventory', detail: 'no positive signal in inventory, workflows, pages, or forms' },
				{ kind: 'expectation', detail: `explicit requirement: "${name}"` },
			], 0.8));
	}
	return { features: out, explorationSufficiency: sufficiency };
}

function row(name, source, classification, assertion, sufficiency, detail, evidence, confidence) {
	return {
		feature: name,
		source,
		classification,
		gapAssertion: assertion,
		detail,
		evidence,
		confidence,
		explorationSufficient: sufficiency.sufficient,
	};
}

export function assessExplorationSufficiency(observations) {
	const reasons = [];
	if ((observations?.pagesObserved ?? 0) < EXPLORATION_GATES.MIN_PAGES) {
		reasons.push(`only ${observations?.pagesObserved ?? 0}/${EXPLORATION_GATES.MIN_PAGES} pages observed`);
	}
	if ((observations?.workflowsTested ?? 0) < EXPLORATION_GATES.MIN_WORKFLOWS_TESTED) {
		reasons.push(`only ${observations?.workflowsTested ?? 0}/${EXPLORATION_GATES.MIN_WORKFLOWS_TESTED} workflows tested`);
	}
	if ((observations?.explorationConfidence ?? 0) < EXPLORATION_GATES.MIN_EXPLORATION_CONFIDENCE) {
		reasons.push(`exploration confidence ${(observations?.explorationConfidence ?? 0).toFixed(2)} < ${EXPLORATION_GATES.MIN_EXPLORATION_CONFIDENCE}`);
	}
	return {
		sufficient: reasons.length === 0,
		reason: reasons.length ? reasons.join('; ') : 'sufficient exploration',
	};
}

function classifySource(ef) {
	const src = String(ef?.source ?? '').toLowerCase();
	const conf = Number(ef?.provenanceConfidence ?? 0);
	if (src === 'requirements' || src === 'expected_features' || src === 'explicit' || src === 'buildPrompt' || src === 'build_prompt' || conf >= EXPLICIT_THRESHOLD) {
		return { tier: EXPECTATION_SOURCES.EXPLICIT, original: src || 'unknown', confidence: conf };
	}
	if (src === 'llm' || src === 'model') return { tier: EXPECTATION_SOURCES.LLM, original: src, confidence: conf };
	return { tier: EXPECTATION_SOURCES.HEURISTIC, original: src || 'unknown', confidence: conf };
}

function matchPositive(name, observations) {
	const n = name.toLowerCase();
	const norm = (s) => String(s ?? '').toLowerCase();
	const verified = (observations?.verifiedFeatures ?? []).map(norm);
	const broken = (observations?.brokenFeatures ?? []).map(norm);
	const positiveSignals = observations?.positiveSignals ?? [];
	const signalFor = positiveSignals.filter(s => norm(s.feature).includes(n) || n.includes(norm(s.feature)));

	const evidence = [];
	if (verified.some(v => v.includes(n) || n.includes(v))) evidence.push({ kind: 'observation', detail: `verified feature match: "${name}"` });
	if (broken.some(v => v.includes(n) || n.includes(v))) evidence.push({ kind: 'observation', detail: `broken feature match: "${name}"` });
	for (const s of signalFor.slice(0, 3)) evidence.push({ kind: 'inventory', detail: `signal in ${s.where}` });

	const blocked = (observations?.blockedWorkflows ?? 0) > 0 &&
		(workflowsMatching(observations, n) === 'blocked');

	return {
		implemented: evidence.some(e => e.kind === 'observation' && e.detail.startsWith('verified')),
		broken: evidence.some(e => e.kind === 'observation' && e.detail.startsWith('broken')),
		partial: signalFor.length > 0 && !evidence.some(e => e.detail.startsWith('verified') || e.detail.startsWith('broken')),
		partialDetail: signalFor.map(s => s.where).slice(0, 2).join(', '),
		blocked,
		evidence,
	};
}

function workflowsMatching(observations, featureName) {
	// blockedWorkflows is a count; if any blocked workflow name mentions the feature, treat as blocked path.
	const blockedNames = (observations?.blockedWorkflowNames ?? []).map(String);
	return blockedNames.some(bn => bn.toLowerCase().includes(featureName)) ? 'blocked' : null;
}

/** Feature completeness score for the quality assessment (0–100 + confidence). */
export function featureCompleteness(validated) {
	const rows = validated?.features ?? [];
	if (rows.length === 0) return { score: null, confidence: 0, counts: {}, coverage: 0 };
	const counts = {};
	for (const r of rows) counts[r.classification] = (counts[r.classification] ?? 0) + 1;
	// Weighted: implemented 1.0, partial 0.5, not_found 0, blocked 0.25 (not the app's fault but incomplete), unverified 0.5 (unknown)
	const total = rows.length;
	let sum = 0, confidentSum = 0, weightSum = 0;
	for (const r of rows) {
		const w = r.classification === GAP_CLASSIFICATION.IMPLEMENTED ? 1
			: r.classification === GAP_CLASSIFICATION.PARTIALLY_IMPLEMENTED ? 0.5
			: r.classification === GAP_CLASSIFICATION.BLOCKED ? 0.25
			: r.classification === GAP_CLASSIFICATION.UNVERIFIED ? 0.5
			: 0;
		sum += w;
		confidentSum += w * r.confidence;
		weightSum += r.confidence;
	}
	const score = Math.round((sum / total) * 100);
	const confidence = weightSum > 0 ? Number((confidentSum / weightSum).toFixed(2)) : 0;
	return { score, confidence, counts, coverage: Number((total > 0 ? 1 : 0).toFixed(2)) };
}
