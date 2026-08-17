'use strict';

/**
 * Phase 18 — Fix Status Engine unit tests (deterministic engine).
 * Run: node --test tests/phase18-unit.test.js
 * No server, no network — pure functions from server/fixStatusEngine.js.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	FIX_STATUSES, VALIDATION_RUN_STATUSES, VALIDATION_REVIEW_STATES,
	requirementsForCategory, assessEvidenceSufficiency, aggregateAttempts,
	computeValidationConfidence, detectPartialFix, classifyRegressions,
	classifyFixStatus, isTrustworthyForKnowledge, canTransitionReview,
	VALIDATION_REVIEW_TRANSITIONS,
} from '../server/fixStatusEngine.js';

const A = (succeeded, sufficient = true) => ({ succeeded, sufficient });

describe('evidence sufficiency per finding type (spec §9)', () => {
	test('functional: steps + expected + state → sufficient', () => {
		const r = assessEvidenceSufficiency({ executed: true, expectedObserved: true, stateCaptured: true }, 'functional');
		assert.equal(r.sufficient, true);
	});

	test('functional: missing expected observation → insufficient', () => {
		const r = assessEvidenceSufficiency({ executed: true, expectedObserved: false, stateCaptured: true }, 'functional');
		assert.equal(r.sufficient, false);
		assert.ok(r.missing.includes('expected_state_observed'));
	});

	test('api family additionally requires network capture', () => {
		const noNet = assessEvidenceSufficiency({ executed: true, expectedObserved: true, stateCaptured: true }, 'API');
		assert.equal(noNet.sufficient, false);
		assert.ok(noNet.missing.includes('network_captured'));
		const withNet = assessEvidenceSufficiency({ executed: true, expectedObserved: true, stateCaptured: true, networkCaptured: true }, 'api_response_failure');
		assert.equal(withNet.sufficient, true);
	});

	test('ux family requires visual capture', () => {
		const r = assessEvidenceSufficiency({ executed: true, expectedObserved: true, stateCaptured: true }, 'ux');
		assert.equal(r.sufficient, false);
		assert.ok(r.missing.includes('visual_captured'));
	});

	test('mobile family requires viewport preserved', () => {
		const r = assessEvidenceSufficiency({ executed: true, expectedObserved: true, stateCaptured: true, viewportPreserved: false }, 'mobile');
		assert.equal(r.sufficient, false);
		assert.ok(r.missing.includes('viewport_preserved'));
	});

	test('category → family mapping', () => {
		assert.equal(requirementsForCategory('API_FAILURE'), 'api');
		assert.equal(requirementsForCategory('MOBILE_LAYOUT'), 'mobile');
		assert.equal(requirementsForCategory('SECURITY'), 'security');
		assert.equal(requirementsForCategory('whatever'), 'other');
	});
});

describe('attempt aggregation (spec §10)', () => {
	test('all success → allSucceeded, reproductionRate 0', () => {
		const a = aggregateAttempts([A(true), A(true), A(true)]);
		assert.equal(a.attempts, 3);
		assert.equal(a.successfulAttempts, 3);
		assert.equal(a.failedAttempts, 0);
		assert.equal(a.reproductionRate, 0);
		assert.equal(a.mixed, false);
	});

	test('mixed attempts → mixed (intermittent ≠ fixed)', () => {
		const a = aggregateAttempts([A(true), A(false)]);
		assert.equal(a.mixed, true);
		assert.equal(a.reproductionRate, 0.5);
	});

	test('all fail → allFailed', () => {
		const a = aggregateAttempts([A(false), A(false)]);
		assert.equal(a.allFailed, true);
		assert.equal(a.reproductionRate, 1);
	});

	test('empty → zeros with null rate', () => {
		const a = aggregateAttempts([]);
		assert.equal(a.attempts, 0);
		assert.equal(a.reproductionRate, null);
	});
});

describe('fix status classification (invariant: deterministic, order matters)', () => {
	const base = {
		originalFailureReproduced: false,
		expectedObserved: true,
		attempts: [A(true), A(true)],
		evidenceSufficient: true,
		environmentMismatch: false,
	};

	test('clean → VERIFIED_FIXED', () => {
		assert.equal(classifyFixStatus(base).status, FIX_STATUSES.VERIFIED_FIXED);
	});

	test('original failure reproduced → STILL_BROKEN (dominates everything)', () => {
		const r = classifyFixStatus({ ...base, originalFailureReproduced: true });
		assert.equal(r.status, FIX_STATUSES.STILL_BROKEN);
		// Even with a regression present, STILL_BROKEN wins (original first).
		const r2 = classifyFixStatus({ ...base, originalFailureReproduced: true, regressions: [{ id: 't1', name: 'n', passed: false, verified: true }] });
		assert.equal(r2.status, FIX_STATUSES.STILL_BROKEN);
	});

	test('verified regression downgrades VERIFIED_FIXED → REGRESSED (invariant 4)', () => {
		const r = classifyFixStatus({ ...base, regressions: [{ id: 't1', name: 'nav test', passed: false, verified: true }] });
		assert.equal(r.status, FIX_STATUSES.REGRESSED);
	});

	test('suspected (unverified) regression does NOT downgrade', () => {
		const r = classifyFixStatus({ ...base, regressions: [{ id: 't1', name: 'nav test', passed: false, verified: false }] });
		assert.equal(r.status, FIX_STATUSES.VERIFIED_FIXED);
		assert.equal(r.regressions.suspectedRegressions.length, 1);
	});

	test('insufficient evidence blocks VERIFIED_FIXED → UNABLE_TO_VERIFY', () => {
		const r = classifyFixStatus({ ...base, evidenceSufficient: false });
		assert.equal(r.status, FIX_STATUSES.UNABLE_TO_VERIFY);
		assert.equal(r.reason, 'evidence_insufficient');
	});

	test('mixed attempts → UNABLE_TO_VERIFY (intermittent ≠ fixed)', () => {
		const r = classifyFixStatus({ ...base, attempts: [A(true), A(false)] });
		assert.equal(r.status, FIX_STATUSES.UNABLE_TO_VERIFY);
		assert.equal(r.reason, 'intermittent_attempts');
	});

	test('inconclusive reproduction → UNABLE_TO_VERIFY', () => {
		const r = classifyFixStatus({ ...base, originalFailureReproduced: null });
		assert.equal(r.status, FIX_STATUSES.UNABLE_TO_VERIFY);
	});

	test('expected not observed and no partial signals → UNABLE_TO_VERIFY', () => {
		const r = classifyFixStatus({ ...base, expectedObserved: false });
		assert.equal(r.status, FIX_STATUSES.UNABLE_TO_VERIFY);
	});

	test('partial fix: core failure remains → PARTIALLY_FIXED', () => {
		const r = classifyFixStatus({
			...base,
			originalFailureReproduced: true,
			subConditions: [
				{ id: 'name', label: 'name updates', fixed: true },
				{ id: 'photo', label: 'photo updates', fixed: false },
			],
		});
		assert.equal(r.status, FIX_STATUSES.PARTIALLY_FIXED);
		assert.equal(r.partial.remaining.length, 1);
	});

	test('partial fix: expected not fully observed with mixed sub-conditions → PARTIALLY_FIXED', () => {
		const r = classifyFixStatus({
			...base,
			expectedObserved: false,
			subConditions: [
				{ id: 'a', label: 'A', fixed: true },
				{ id: 'b', label: 'B', fixed: false },
			],
		});
		assert.equal(r.status, FIX_STATUSES.PARTIALLY_FIXED);
	});

	test('environment mismatch only blocks when it prevented observation', () => {
		const r = classifyFixStatus({ ...base, environmentMismatch: true, originalFailureReproduced: null });
		assert.equal(r.status, FIX_STATUSES.UNABLE_TO_VERIFY);
		const r2 = classifyFixStatus({ ...base, environmentMismatch: true });
		// Decisive observation despite mismatch → still verifiable.
		assert.equal(r2.status, FIX_STATUSES.VERIFIED_FIXED);
	});
});

describe('validation confidence (spec §14 — new measurement)', () => {
	test('floor: nothing positive observed → 0', () => {
		assert.equal(computeValidationConfidence({}), 0);
	});

	test('perfect signals → high confidence', () => {
		const c = computeValidationConfidence({
			samePath: true, sameEnvironment: true, repeatedSuccess: true,
			expectedReached: true, originalAbsent: true, consoleClean: true,
			networkOk: true, regressionPassed: true, evidenceComplete: true,
			attemptsStable: true,
		});
		assert.ok(c >= 0.95, `expected >=0.95 got ${c}`);
	});

	test('intermittent attempts cut confidence hard', () => {
		const good = computeValidationConfidence({ expectedReached: true, originalAbsent: true, samePath: true, attemptsStable: true });
		const intermittent = computeValidationConfidence({ expectedReached: true, originalAbsent: true, samePath: true, attemptsStable: false });
		assert.ok(good - intermittent >= 0.25);
	});

	test('independent of any finding confidence — pure function of signals', () => {
		const a = computeValidationConfidence({ expectedReached: true });
		const b = computeValidationConfidence({ expectedReached: true });
		assert.equal(a, b);
		// Minimal positive signal stays in the low band (not 0, not high).
		assert.ok(a > 0 && a < 0.5, `expected low band got ${a}`);
	});
});

describe('regression classification', () => {
	test('verified vs suspected separation', () => {
		const r = classifyRegressions([
			{ id: '1', name: 'a', passed: true, verified: true },
			{ id: '2', name: 'b', passed: false, verified: true },
			{ id: '3', name: 'c', passed: false, verified: false },
		]);
		assert.equal(r.hasVerifiedRegression, true);
		assert.equal(r.verifiedRegressions.length, 1);
		assert.equal(r.suspectedRegressions.length, 1);
		assert.equal(r.passed, 1);
		assert.equal(r.total, 3);
	});
});

describe('knowledge gating (spec §17)', () => {
	test('VERIFIED_FIXED ≥0.7 stored', () => {
		assert.equal(isTrustworthyForKnowledge(FIX_STATUSES.VERIFIED_FIXED, 0.75), true);
	});

	test('VERIFIED_FIXED below 0.7 NOT stored', () => {
		assert.equal(isTrustworthyForKnowledge(FIX_STATUSES.VERIFIED_FIXED, 0.6), false);
	});

	test('STILL_BROKEN high confidence stored (failure knowledge)', () => {
		assert.equal(isTrustworthyForKnowledge(FIX_STATUSES.STILL_BROKEN, 0.9), true);
	});

	test('UNABLE_TO_VERIFY never stored', () => {
		assert.equal(isTrustworthyForKnowledge(FIX_STATUSES.UNABLE_TO_VERIFY, 1), false);
	});

	test('PARTIALLY_FIXED / REGRESSED never auto-stored as confirmed fact', () => {
		assert.equal(isTrustworthyForKnowledge(FIX_STATUSES.PARTIALLY_FIXED, 0.95), false);
		assert.equal(isTrustworthyForKnowledge(FIX_STATUSES.REGRESSED, 0.95), false);
	});
});

describe('review transitions (spec §13 — human-only closure)', () => {
	test('APPROVED can only REOPEN', () => {
		assert.equal(canTransitionReview('APPROVED', 'REOPENED'), true);
		assert.equal(canTransitionReview('APPROVED', 'REJECTED'), false);
		assert.equal(canTransitionReview('APPROVED', 'APPROVED'), false);
	});

	test('REVIEW_REQUIRED → APPROVED/REJECTED valid', () => {
		assert.equal(canTransitionReview('REVIEW_REQUIRED', 'APPROVED'), true);
		assert.equal(canTransitionReview('REVIEW_REQUIRED', 'REJECTED'), true);
	});

	test('REOPENED can be re-closed', () => {
		assert.equal(canTransitionReview('REOPENED', 'APPROVED'), true);
		assert.equal(canTransitionReview('REJECTED', 'REOPENED'), true);
	});

	test('every state has an outgoing path (no dead ends)', () => {
		for (const s of Object.values(VALIDATION_REVIEW_STATES)) {
			assert.ok(Array.isArray(VALIDATION_REVIEW_TRANSITIONS[s]) && VALIDATION_REVIEW_TRANSITIONS[s].length > 0, s);
		}
	});
});

describe('enums are stable (contract)', () => {
	test('fix statuses match the spec', () => {
		assert.deepEqual(Object.values(FIX_STATUSES).sort(), [
			'PARTIALLY_FIXED', 'REGRESSED', 'STILL_BROKEN', 'UNABLE_TO_VERIFY', 'VERIFIED_FIXED',
		]);
	});

	test('run statuses REQUESTED→…→CANCELLED', () => {
		assert.deepEqual(Object.values(VALIDATION_RUN_STATUSES), ['REQUESTED', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']);
	});

	test('review states', () => {
		assert.deepEqual(Object.values(VALIDATION_REVIEW_STATES), ['AUTO_VALIDATED', 'REVIEW_REQUIRED', 'APPROVED', 'REJECTED', 'REOPENED']);
	});
});
