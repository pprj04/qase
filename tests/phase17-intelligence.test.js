'use strict';

/**
 * Phase 17 — unit tests: friction, feature-gap validation, recommendations,
 * quality assessment.
 * Run: node --test tests/phase17-intelligence.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeWorkflowFriction, analyzeFriction, frictionDimension, FRICTION_TYPES } from '../server/uxFriction.js';
import { validateFeatureGaps, featureCompleteness, GAP_CLASSIFICATION, GAP_ASSERTION, assessExplorationSufficiency } from '../server/featureGapValidation.js';
import { buildRecommendations, computePriorityScore, PRIORITIES } from '../server/recommendationEngine.js';
import { buildQualityAssessment, QUALITY_DIMENSIONS, DIMENSION_WEIGHTS } from '../server/qualityAssessment.js';

/* ── FRICTION ───────────────────────────────────────────────────── */

describe('friction analysis', () => {

	const step = (i, over = {}) => ({ index: i, action: 'click', description: 'do', target: '#btn', status: 'pass', ...over });

	test('excessive steps flagged when 2x expected', () => {
		const steps = Array.from({ length: 14 }, (_, i) => step(i));
		const pts = analyzeWorkflowFriction({ name: 'checkout', status: 'pass', expectedSteps: 6, steps });
		assert.ok(pts.some(p => p.type === FRICTION_TYPES.EXCESSIVE_STEPS));
	});

	test('not flagged under threshold', () => {
		const steps = Array.from({ length: 5 }, (_, i) => step(i));
		const pts = analyzeWorkflowFriction({ name: 'login', status: 'pass', expectedSteps: 4, steps });
		assert.ok(!pts.some(p => p.type === FRICTION_TYPES.EXCESSIVE_STEPS));
	});

	test('repeated entry detected', () => {
		const steps = [
			step(0, { fieldsFilled: ['email'] }),
			step(1),
			step(2, { fieldsFilled: ['Email', 'name'] }),
		];
		const pts = analyzeWorkflowFriction({ name: 'signup', status: 'pass', steps });
		const rep = pts.find(p => p.type === FRICTION_TYPES.REPEATED_ENTRY);
		assert.ok(rep);
		assert.equal(rep.severity, 'medium');
		assert.ok(rep.evidence.length >= 2);
	});

	test('retry loop detected on failed→same action', () => {
		const steps = [
			step(0, { action: 'submit', target: '#form', status: 'failed' }),
			step(1, { action: 'submit', target: '#form', status: 'pass' }),
		];
		const pts = analyzeWorkflowFriction({ name: 'save', status: 'pass', steps });
		assert.ok(pts.some(p => p.type === FRICTION_TYPES.RETRY_LOOP));
	});

	test('missing confirmation on destructive action', () => {
		const steps = [step(0, { description: 'delete contact', action: 'click', dialogAppeared: false })];
		const pts = analyzeWorkflowFriction({ name: 'crm', status: 'pass', steps });
		const mc = pts.find(p => p.type === FRICTION_TYPES.MISSING_CONFIRMATION);
		assert.ok(mc);
		assert.equal(mc.severity, 'high');
		assert.equal(mc.confidence, 0.75);
	});

	test('destructive action WITH dialog not flagged', () => {
		const steps = [step(0, { description: 'delete contact', dialogAppeared: true })];
		const pts = analyzeWorkflowFriction({ name: 'crm', status: 'pass', steps });
		assert.ok(!pts.some(p => p.type === FRICTION_TYPES.MISSING_CONFIRMATION));
	});

	test('blocked workflow = dead end high', () => {
		const pts = analyzeWorkflowFriction({ name: 'pay', status: 'blocked', steps: [step(0, { status: 'blocked' })] });
		const de = pts.find(p => p.type === FRICTION_TYPES.DEAD_END);
		assert.ok(de);
		assert.equal(de.severity, 'high');
	});

	test('unclear next action: passed, filled fields, same URL', () => {
		const pts = analyzeWorkflowFriction({ name: 'profile', status: 'pass', urlStart: '/profile', urlEnd: '/profile', steps: [step(0, { fieldsFilled: ['bio'] })] });
		assert.ok(pts.some(p => p.type === FRICTION_TYPES.UNCLEAR_NEXT_ACTION));
	});

	test('aggregate: perWorkflow rows + dimension', () => {
		const { frictionPoints, perWorkflow } = analyzeFriction([
			{ name: 'a', status: 'pass', steps: [step(0, { description: 'delete x' })] },
			{ name: 'b', status: 'pass', steps: [step(0)] },
		]);
		assert.equal(frictionPoints.length, 1);
		assert.equal(perWorkflow.length, 2);
		const dim = frictionDimension(frictionPoints);
		assert.equal(dim.dimension, 'USER_FLOW_FRICTION');
		assert.ok(dim.score < 100);
		assert.equal(dim.confidence, 0.8);
	});

	test('empty runs → zero friction, dimension confidence 0', () => {
		const dim = frictionDimension([]);
		assert.equal(dim.score, 100);
		assert.equal(dim.confidence, 0);
	});
});

/* ── FEATURE GAP VALIDATION ─────────────────────────────────────── */

describe('feature gap validation', () => {

	const sufficientObs = (over = {}) => ({
		verifiedFeatures: ['login'],
		brokenFeatures: [],
		pagesObserved: 6,
		workflowsTested: 3,
		workflowsPassed: 2,
		blockedWorkflows: 0,
		explorationConfidence: 0.7,
		...over,
	});

	test('explicit expectation + sufficient exploration + no signal → CONFIRMED gap', () => {
		const { features } = validateFeatureGaps(
			[{ name: 'export contacts', source: 'requirements', provenanceConfidence: 0.95 }],
			sufficientObs(),
		);
		assert.equal(features[0].classification, GAP_CLASSIFICATION.NOT_FOUND);
		assert.equal(features[0].gapAssertion, GAP_ASSERTION.CONFIRMED);
		assert.ok(features[0].confidence >= 0.8);
	});

	test('heuristic expectation → POTENTIAL only, never CONFIRMED', () => {
		const { features } = validateFeatureGaps(
			[{ name: 'dark mode', source: 'domain_catalog', provenanceConfidence: 0.4 }],
			sufficientObs(),
		);
		assert.equal(features[0].gapAssertion, GAP_ASSERTION.POTENTIAL);
		assert.equal(features[0].classification, GAP_CLASSIFICATION.NOT_FOUND);
	});

	test('insufficient exploration → UNVERIFIED, not marked missing', () => {
		const { features, explorationSufficiency } = validateFeatureGaps(
			[{ name: 'export contacts', source: 'requirements', provenanceConfidence: 0.95 }],
			sufficientObs({ pagesObserved: 1, workflowsTested: 0, explorationConfidence: 0.1 }),
		);
		assert.equal(features[0].classification, GAP_CLASSIFICATION.UNVERIFIED);
		assert.equal(features[0].gapAssertion, GAP_ASSERTION.POTENTIAL);
		assert.equal(explorationSufficiency.sufficient, false);
	});

	test('verified feature → IMPLEMENTED, no gap', () => {
		const { features } = validateFeatureGaps(
			[{ name: 'login', source: 'requirements' }],
			sufficientObs(),
		);
		assert.equal(features[0].classification, GAP_CLASSIFICATION.IMPLEMENTED);
		assert.equal(features[0].gapAssertion, GAP_ASSERTION.NONE);
	});

	test('broken feature → IMPLEMENTED but flagged broken (functional defect, not a gap)', () => {
		const { features } = validateFeatureGaps(
			[{ name: 'import', source: 'requirements' }],
			sufficientObs({ verifiedFeatures: [], brokenFeatures: ['import'] }),
		);
		assert.equal(features[0].classification, GAP_CLASSIFICATION.IMPLEMENTED);
		assert.ok(features[0].detail.includes('broken'));
	});

	test('partial signal → PARTIALLY_IMPLEMENTED', () => {
		const { features } = validateFeatureGaps(
			[{ name: 'user settings', source: 'requirements' }],
			sufficientObs({ positiveSignals: [{ feature: 'user settings', where: 'form on /settings' }] }),
		);
		assert.equal(features[0].classification, GAP_CLASSIFICATION.PARTIALLY_IMPLEMENTED);
	});

	test('blocked workflow → BLOCKED not NOT_FOUND', () => {
		const { features } = validateFeatureGaps(
			[{ name: 'billing', source: 'requirements' }],
			sufficientObs({ blockedWorkflows: 1, blockedWorkflowNames: ['billing checkout'] }),
		);
		assert.equal(features[0].classification, GAP_CLASSIFICATION.BLOCKED);
	});

	test('featureCompleteness scoring', () => {
		const v = { features: [
			{ classification: 'IMPLEMENTED', confidence: 0.9 },
			{ classification: 'IMPLEMENTED', confidence: 0.9 },
			{ classification: 'PARTIALLY_IMPLEMENTED', confidence: 0.7 },
			{ classification: 'NOT_FOUND', confidence: 0.8 },
		] };
		const c = featureCompleteness(v);
		assert.equal(c.score, Math.round(((1 + 1 + 0.5 + 0) / 4) * 100));
		assert.ok(c.confidence > 0 && c.confidence <= 1);
		assert.equal(featureCompleteness({ features: [] }).score, null);
	});
});

/* ── RECOMMENDATIONS ────────────────────────────────────────────── */

describe('recommendation engine', () => {

	const issue = (over = {}) => ({
		id: 'uxi_0001_a11y_document_l',
		kind: 'ACCESSIBILITY_ISSUE',
		checkId: 'a11y_document_lang',
		dimension: 'ACCESSIBILITY',
		title: 'html lang attribute missing',
		severity: 'low',
		occurrences: 1,
		confidence: 0.65,
		evidence: [{ kind: 'dom', detail: 'html@lang empty' }],
		reviewState: 'AUTO_VERIFIED',
		impact: 'Minor annoyance',
		...over,
	});

	test('recommendation references the issue and its evidence', () => {
		const recs = buildRecommendations({ uxIssues: [issue()] });
		assert.equal(recs.length, 1);
		assert.equal(recs[0].refType, 'ux_issue');
		assert.equal(recs[0].refId, issue().id);
		assert.ok(recs[0].evidence.length > 0);
		assert.ok(recs[0].recommendation.length > 20);
		assert.ok(PRIORITIES.includes(recs[0].priority));
	});

	test('REJECTED issues produce no recommendation', () => {
		const recs = buildRecommendations({ uxIssues: [issue({ reviewState: 'REJECTED' })] });
		assert.equal(recs.length, 0);
	});

	test('priority formula: severity dominates; uncertainty capped', () => {
		const high = computePriorityScore({ severity: 'high', confidence: 1.0, dimension: 'FORM_USABILITY', occurrences: 1 });
		const highUncertain = computePriorityScore({ severity: 'high', confidence: 0.4, dimension: 'FORM_USABILITY', occurrences: 1 });
		const low = computePriorityScore({ severity: 'low', confidence: 1.0 });
		assert.ok(high > highUncertain);
		assert.ok(highUncertain <= 30, `uncertain capped at 30, got ${highUncertain}`);
		assert.ok(low < high);
	});

	test('P0 requires severity critical or high + confidence', () => {
		const score = computePriorityScore({ severity: 'critical', confidence: 1.0, workflow: 'checkout', dimension: 'NAVIGATION', occurrences: 5 });
		assert.ok(score >= 85, `expected P0-range score, got ${score}`);
	});

	test('confirmed feature gap yields high-priority rec; potential yields review rec', () => {
		const recs = buildRecommendations({ featureGaps: [
			{ feature: 'export contacts', classification: 'NOT_FOUND', gapAssertion: 'CONFIRMED_FEATURE_GAP', confidence: 0.8, evidence: [] },
			{ feature: 'dark mode', classification: 'NOT_FOUND', gapAssertion: 'POTENTIAL_FEATURE_GAP', confidence: 0.5, evidence: [] },
		] });
		assert.equal(recs.length, 2);
		const confirmed = recs.find(r => r.refId === 'export contacts');
		const potential = recs.find(r => r.refId === 'dark mode');
		assert.equal(confirmed.severity, 'high');
		assert.ok(confirmed.priorityScore > potential.priorityScore);
		assert.ok(potential.recommendation.includes('verify'));
	});

	test('friction produces workflow-linked recommendation', () => {
		const recs = buildRecommendations({ frictionPoints: [
			{ id: 'fx_crm_missing_confirmation_1', type: 'MISSING_CONFIRMATION', workflow: 'CRM delete', severity: 'high', confidence: 0.75, detail: 'no dialog', evidence: [{ kind: 'step_outcome', detail: 'step 0' }] },
		] });
		assert.equal(recs.length, 1);
		assert.equal(recs[0].workflow, 'CRM delete');
		assert.ok(recs[0].priorityScore >= 60);   // high(70)+20 wf + 15 form-ish? >= P1
	});
});

/* ── QUALITY ASSESSMENT ─────────────────────────────────────────── */

describe('quality assessment', () => {

	const uxDim = (dimension, score, confidence, coverage = 0.8) => ({ dimension, score, confidence, evidenceCoverage: coverage, decisive: 5, unverified: 1, occurrenceSummary: {} });

	test('all dimensions assembled with confidence and coverage', () => {
		const a = buildQualityAssessment({
			functionalScore: 86,
			uxDimensions: [uxDim('NAVIGATION', 90, 0.8), uxDim('ACCESSIBILITY', 70, 0.7), uxDim('FORM_USABILITY', 80, 0.9)],
			completeness: { score: 69, confidence: 0.8, coverage: 0.9 },
			workflowOutcomes: { total: 4, passed: 3, failed: 1, blocked: 0 },
		});
		const names = a.dimensions.map(d => d.dimension);
		for (const expected of ['FUNCTIONAL', 'UX', 'ACCESSIBILITY', 'FEATURE_COMPLETENESS', 'NAVIGATION', 'WORKFLOW_RELIABILITY']) {
			assert.ok(names.includes(expected), `missing ${expected}`);
		}
		assert.equal(a.dimensions.find(d => d.dimension === 'WORKFLOW_RELIABILITY').score, 75);
		assert.ok(a.overall.score > 0 && a.overall.score <= 100);
		assert.ok(a.overall.confidence > 0);
		assert.ok(a.overall.evidenceCoverage > 0);
	});

	test('no data → null overall, missing dimensions listed, never guessed', () => {
		const a = buildQualityAssessment({});
		assert.equal(a.overall.score, null);
		assert.equal(a.overall.confidence, 0);
		assert.deepEqual(a.overall.dimensionsMissing, QUALITY_DIMENSIONS);
		assert.equal(a.dimensions.length, 0);
	});

	test('missing individual dimensions excluded from overall mean', () => {
		const a = buildQualityAssessment({
			functionalScore: 90,
			uxDimensions: [],
			completeness: null,
			workflowOutcomes: null,
		});
		assert.equal(a.dimensions.length, 1);
		assert.equal(a.overall.score, 90);
		assert.ok(a.overall.dimensionsMissing.includes('UX'));
	});

	test('weighted mean respects DIMENSION_WEIGHTS', () => {
		// FUNCTIONAL w=3 score=100, ACCESSIBILITY w=1.5 score=50 → (300+75)/4.5 = 83.33 → 83
		const a = buildQualityAssessment({
			functionalScore: 100,
			uxDimensions: [uxDim('ACCESSIBILITY', 50, 0.9)],
		});
		assert.equal(a.overall.score, 83);
	});

	test('UX dimension is mean of ux rows minus accessibility', () => {
		const a = buildQualityAssessment({
			uxDimensions: [uxDim('NAVIGATION', 80, 0.8), uxDim('ACCESSIBILITY', 40, 0.8), uxDim('FORM_USABILITY', 90, 0.8)],
		});
		const ux = a.dimensions.find(d => d.dimension === 'UX');
		assert.equal(ux.score, 85);   // (80+90)/2
	});
});
