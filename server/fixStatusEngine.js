/**
 * Phase 18 — Fix Status Engine (pure, deterministic, no I/O, no LLM).
 *
 * Classifies fix-validation outcomes from evidence. The final fix status is
 * DERIVED here and nowhere else — an LLM may never select it (spec invariant 2).
 *
 * Statuses:
 *   VERIFIED_FIXED   original failure no longer occurs AND expected behavior
 *                    observed AND evidence sufficient AND attempts consistent
 *   STILL_BROKEN     original failure still occurs
 *   PARTIALLY_FIXED  some original failure conditions fixed, related conditions
 *                    remain (sub-condition tracking)
 *   REGRESSED        original fixed but a verified regression exists in the
 *                    targeted regression set
 *   UNABLE_TO_VERIFY insufficient evidence / unstable attempts / environment
 *                    mismatch prevented a trustworthy conclusion
 */

export const FIX_STATUSES = Object.freeze({
	VERIFIED_FIXED: 'VERIFIED_FIXED',
	STILL_BROKEN: 'STILL_BROKEN',
	PARTIALLY_FIXED: 'PARTIALLY_FIXED',
	REGRESSED: 'REGRESSED',
	UNABLE_TO_VERIFY: 'UNABLE_TO_VERIFY',
});

/** Run (job) lifecycle — orthogonal to fix status. */
export const VALIDATION_RUN_STATUSES = Object.freeze({
	REQUESTED: 'REQUESTED',
	QUEUED: 'QUEUED',
	RUNNING: 'RUNNING',
	COMPLETED: 'COMPLETED',
	FAILED: 'FAILED',
	CANCELLED: 'CANCELLED',
});

/** Human review states for the final lifecycle closure. */
export const VALIDATION_REVIEW_STATES = Object.freeze({
	AUTO_VALIDATED: 'AUTO_VALIDATED',
	REVIEW_REQUIRED: 'REVIEW_REQUIRED',
	APPROVED: 'APPROVED',
	REJECTED: 'REJECTED',
	REOPENED: 'REOPENED',
});

/** Evidence requirements by finding category family (spec §9). */
const EVIDENCE_REQUIREMENTS = {
	functional: ['steps_executed', 'expected_state_observed', 'resulting_state_captured'],
	api: ['steps_executed', 'expected_state_observed', 'resulting_state_captured', 'network_captured'],
	ux: ['steps_executed', 'expected_state_observed', 'resulting_state_captured', 'visual_captured'],
	mobile: ['steps_executed', 'expected_state_observed', 'resulting_state_captured', 'viewport_preserved'],
	security: ['steps_executed', 'expected_state_observed', 'resulting_state_captured'],
	other: ['steps_executed', 'resulting_state_captured'],
};

/** Map a Phase 16 category to a requirement family. */
export function requirementsForCategory(category) {
	const c = String(category || '').toLowerCase();
	// Order matters: mobile/responsive before the ux/ui/layout family so
	// e.g. MOBILE_LAYOUT maps to the mobile requirements (viewport preserved).
	if (c.includes('mobile') || c.includes('responsive')) return 'mobile';
	if (c.includes('api') || c.includes('backend') || c.includes('data')) return 'api';
	if (c.includes('ux') || c.includes('ui') || c.includes('layout')) return 'ux';
	if (c.includes('security') || c.includes('auth')) return 'security';
	if (c.includes('functional') || c.includes('form') || c.includes('workflow')) return 'functional';
	return 'other';
}

/**
 * Evidence sufficiency for ONE attempt result.
 * attempt = { executed: bool, expectedObserved: bool, stateCaptured: bool,
 *             networkCaptured?: bool, visualCaptured?: bool, viewportPreserved?: bool,
 *             originalFailureReproduced: bool|null }
 * Returns { sufficient: bool, missing: string[] }.
 */
export function assessEvidenceSufficiency(attempt, category = 'functional') {
	const family = requirementsForCategory(category);
	const req = EVIDENCE_REQUIREMENTS[family];
	const have = {
		steps_executed: Boolean(attempt?.executed),
		expected_state_observed: Boolean(attempt?.expectedObserved),
		resulting_state_captured: Boolean(attempt?.stateCaptured),
		network_captured: Boolean(attempt?.networkCaptured ?? attempt?.network_captured),
		visual_captured: Boolean(attempt?.visualCaptured ?? attempt?.visual_captured),
		viewport_preserved: attempt?.viewportPreserved === undefined && attempt?.viewport_preserved === undefined
			? true
			: Boolean(attempt?.viewportPreserved ?? attempt?.viewport_preserved),
	};
	const missing = req.filter(r => !have[r]);
	return { sufficient: missing.length === 0, missing, required: req };
}

/**
 * Attempt aggregation across a validation (and prior attempts of the same finding).
 * attempts = [{ succeeded: bool, sufficient: bool }]  (succeeded = fix observed in
 * that attempt). Returns stability metrics. Intermittent = mixed results.
 */
/** Minimum executed attempts before a clean run can be VERIFIED_FIXED (mandate §2). */
export const MIN_VERIFIED_ATTEMPTS = 2;

export function aggregateAttempts(attempts) {
	const list = Array.isArray(attempts) ? attempts : [];
	const total = list.length;
	const executed = list.filter(a => a && a.executed !== false).length;
	const successes = list.filter(a => a?.succeeded).length;
	const failures = list.filter(a => a && a.executed !== false && !a.succeeded).length;
	const reproductionRate = executed > 0 ? Number((failures / executed).toFixed(2)) : null; // rate the ORIGINAL failure still reproduced
	return {
		attempts: total,
		executed,
		successfulAttempts: successes,
		failedAttempts: failures,
		reproductionRate,
		allSucceeded: executed > 0 && failures === 0,
		allFailed: executed > 0 && successes === 0,
		mixed: successes > 0 && failures > 0,
	};
}

/**
 * Validation confidence — a NEW measurement (never the finding's confidence).
 * signals (booleans unless noted):
 *   samePath          original reproduction path reused
 *   sameEnvironment   no environment deltas (or only trivial ones)
 *   repeatedSuccess   ≥2 successful attempts
 *   expectedReached   expected state observed in final attempt
 *   originalAbsent    original failure not reproduced in final attempt
 *   consoleClean
 *   networkOk
 *   regressionPassed  targeted regression set passed (or was empty-but-justified)
 *   evidenceComplete  sufficiency passed for final attempt
 *   attemptsStable    no mixed success/fail across attempts (numeric check inside)
 * Returns 0–1.
 */
export function computeValidationConfidence(signals = {}) {
	const {
		samePath = false,
		sameEnvironment = false,
		repeatedSuccess = false,
		expectedReached = false,
		originalAbsent = false,
		consoleClean = false,
		networkOk = false,
		regressionPassed = false,
		evidenceComplete = false,
		attemptsStable, // tri-state: true | false | undefined (unknown)
		originalFailureReproduced = null,
		repeatedReproduction = false,
	} = signals;
	if (!expectedReached && !originalAbsent) {
		// Still-decisive negative observation: the original failure reproduced
		// deterministically is STRONG evidence (spec §14: failure knowledge is
		// knowledge). Confidence for STILL_BROKEN derives from repro path,
		// environment sameness, repetition, and evidence completeness.
		if (signals.originalFailureReproduced === true) {
			let score = 0.70; // base: failure reproduced on the original path
			if (samePath) score += 0.10;
			if (sameEnvironment) score += 0.05;
			if (signals.repeatedReproduction) score += 0.10;
			if (consoleClean !== null ? consoleClean : true) score += 0.0; // console noise is expected while broken — neutral
			if (evidenceComplete) score += 0.05;
			return Math.max(0, Math.min(1, Number(score.toFixed(2))));
		}
		return 0; // nothing decisive observed
	}
	let score = 0.20; // base for having run and observed something decisive
	if (samePath) score += 0.15;
	if (sameEnvironment) score += 0.10;
	if (repeatedSuccess) score += 0.10;
	if (expectedReached) score += 0.15;
	if (originalAbsent) score += 0.10;
	if (consoleClean) score += 0.05;
	if (networkOk) score += 0.05;
	if (regressionPassed) score += 0.05;
	if (evidenceComplete) score += 0.05;
	if (!attemptsStable) score -= 0.25; // intermittent observed → distrust
	// attemptsStable defaults to false; treat an explicitly-omitted signal as
	// "unknown" (neither boost nor penalty) — single-decisive-observation runs
	// (repeatedSuccess false) still earn a mid-band confidence.
	if (signals.attemptsStable === undefined && !repeatedSuccess) score += 0;
	return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

/**
 * Partial-fix detection. subConditions = [{ id, label, fixed: bool|null }]
 * (null = untested). Returns { partial: bool, fixedCount, remaining: [...] }.
 */
export function detectPartialFix(subConditions = []) {
	const list = (subConditions || []).filter(s => s && typeof s.fixed === 'boolean');
	const fixed = list.filter(s => s.fixed === true);
	const remaining = list.filter(s => s.fixed === false);
	return {
		partial: fixed.length > 0 && remaining.length > 0,
		fixedCount: fixed.length,
		testedCount: list.length,
		remaining: remaining.map(s => ({ id: s.id, label: s.label })),
	};
}

/**
 * Regression classification for the targeted regression set.
 * results = [{ id, name, passed: bool, verified: bool }]
 * verified = the regression failure itself was re-verified (not a flake).
 */
export function classifyRegressions(results = []) {
	const list = results || [];
	const verified = list.filter(r => r && r.passed === false && r.verified !== false);
	const suspected = list.filter(r => r && r.passed === false && r.verified === false);
	return {
		hasVerifiedRegression: verified.length > 0,
		verifiedRegressions: verified.map(r => ({ id: r.id, name: r.name })),
		suspectedRegressions: suspected.map(r => ({ id: r.id, name: r.name })),
		passed: list.filter(r => r?.passed === true).length,
		total: list.length,
	};
}

/**
 * THE deterministic classification (invariant: no LLM selects the status).
 *
 * outcome = {
 *   originalFailureReproduced: bool|null,   // null = could not determine
 *   expectedObserved: bool|null,
 *   subConditions?: [...],                  // optional partial-fix probes
 *   attempts: [{succeeded, sufficient}],
 *   regressions?: [...],                    // targeted set results
 *   evidenceSufficient: bool,
 *   environmentMismatch: bool,              // non-trivial deltas
 * }
 */
export function classifyFixStatus(outcome) {
	const o = outcome || {};
	const attempts = aggregateAttempts(o.attempts || []);
	const regressions = classifyRegressions(o.regressions || []);

	// 1. Environment mismatch blocks a trustworthy conclusion only when it also
	//    prevented decisive observation.
	if (o.environmentMismatch && o.originalFailureReproduced === null) {
		return { status: FIX_STATUSES.UNABLE_TO_VERIFY, reason: 'environment_mismatch', attempts, regressions };
	}

	// 2. Original failure reproduced → still broken, regardless of anything else.
	if (o.originalFailureReproduced === true) {
		// Partial-fix check first: if some sub-conditions ARE fixed while the core
		// failure reproduces, that is PARTIALLY_FIXED.
		const partial = detectPartialFix(o.subConditions);
		if (partial.partial) {
			return { status: FIX_STATUSES.PARTIALLY_FIXED, reason: 'core_failure_remains', partial, attempts, regressions };
		}
		return { status: FIX_STATUSES.STILL_BROKEN, reason: 'original_failure_reproduced', attempts, regressions };
	}

	// 3. Could not determine reproduction → unverifiable.
	if (o.originalFailureReproduced === null) {
		return { status: FIX_STATUSES.UNABLE_TO_VERIFY, reason: 'reproduction_inconclusive', attempts, regressions };
	}

	// 4. Failure absent. Expected behavior observed?
	if (o.expectedObserved !== true) {
		const partial = detectPartialFix(o.subConditions);
		if (partial.partial) {
			return { status: FIX_STATUSES.PARTIALLY_FIXED, reason: 'expected_not_fully_observed', partial, attempts, regressions };
		}
		return { status: FIX_STATUSES.UNABLE_TO_VERIFY, reason: 'expected_behavior_not_observed', attempts, regressions };
	}

	// 5. Failure absent + expected observed, but unstable attempts → not "definitely fixed".
	if (attempts.mixed) {
		return { status: FIX_STATUSES.UNABLE_TO_VERIFY, reason: 'intermittent_attempts', attempts, regressions };
	}

	// 5b. Mandate §2: NEVER auto-mark fixed from a single non-reproducing execution.
	// A clean single attempt is decisive evidence the failure is absent, but not
	// that it is FIXED — require at least MIN_VERIFIED_ATTEMPTS attempts AND a
	// reproduction rate that does not indicate intermittency.
	if (attempts.executed > 0 && (attempts.executed < MIN_VERIFIED_ATTEMPTS || attempts.reproductionRate > 0)) {
		return { status: FIX_STATUSES.UNABLE_TO_VERIFY, reason: attempts.executed < MIN_VERIFIED_ATTEMPTS ? 'insufficient_attempt_count' : 'intermittent_attempts', attempts, regressions };
	}

	// 6. Evidence insufficiency blocks VERIFIED_FIXED (mandate §9).
	if (!o.evidenceSufficient) {
		return { status: FIX_STATUSES.UNABLE_TO_VERIFY, reason: 'evidence_insufficient', attempts, regressions };
	}

	// 7. Verified regression downgrades REGRESSED over VERIFIED_FIXED (invariant 4).
	if (regressions.hasVerifiedRegression) {
		return { status: FIX_STATUSES.REGRESSED, reason: 'verified_regression_in_targeted_set', attempts, regressions };
	}

	// 8. Clean: verified fixed.
	return { status: FIX_STATUSES.VERIFIED_FIXED, reason: 'failure_absent_expected_observed_evidence_sufficient', attempts, regressions };
}

/** Knowledge gating (spec invariant 8). Only trustworthy outcomes persist. */
export function isTrustworthyForKnowledge(fixStatus, validationConfidence) {
	if (fixStatus === FIX_STATUSES.VERIFIED_FIXED || fixStatus === FIX_STATUSES.STILL_BROKEN) {
		return Number(validationConfidence) >= 0.7;
	}
	return false;
}

/** Review transition table (human-only closure states). */
export const VALIDATION_REVIEW_TRANSITIONS = Object.freeze({
	AUTO_VALIDATED: ['APPROVED', 'REJECTED', 'REOPENED', 'REVIEW_REQUIRED'],
	REVIEW_REQUIRED: ['APPROVED', 'REJECTED', 'REOPENED', 'AUTO_VALIDATED'],
	APPROVED: ['REOPENED'],
	REJECTED: ['REOPENED'],
	REOPENED: ['APPROVED', 'REJECTED', 'AUTO_VALIDATED'],
});

export function canTransitionReview(from, to) {
	const allowed = VALIDATION_REVIEW_TRANSITIONS[from];
	return Boolean(allowed && allowed.includes(to));
}
