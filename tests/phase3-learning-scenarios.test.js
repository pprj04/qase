/**
 * Phase 3 — Multi-Mission Learning Validation Scenario
 *
 * Demonstrates the complete learning loop:
 *   Mission 1 → Discover pattern → Knowledge created
 *   Mission 2 → Similar app → Knowledge retrieved → Hint injected → Area validated → Confirmed
 *   Mission 3 → Same pattern again → Confidence increases
 *   Mission 4 → Current evidence contradicts → Confidence decreases → Current wins
 *   Mission 5 → Pattern has decayed from disuse → Lower confidence
 *
 * This is the most important Phase 3 demonstration.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
	writeKnowledge,
	queryKnowledge,
	validateKnowledge,
	detectKnowledgeConflicts,
	generateExplorationHints,
	getAllPatterns,
	getPatternProvenance,
	getKnowledgeStats,
	clearAllPatterns,
	_flushSync,
	detectAppMetadata,
} from '../server/knowledge.js';
import { calculateConfidence, VALIDATION_RESULTS, KNOWLEDGE_STATUS } from '../server/knowledgeModel.js';

beforeEach(() => clearAllPatterns());
afterEach(() => { clearAllPatterns(); _flushSync(); });

function makeSession(opts = {}) {
	return {
		id: opts.id || 'test-session',
		targetUrl: opts.targetUrl || 'https://app.example.com',
		capturedSteps: opts.capturedSteps || [
			{ url: 'https://app.example.com/_next/page', target: '', label: '', outcome: { status: 'success', urlAfter: 'https://app.example.com/', titleAfter: 'App' } },
		],
		activities: opts.activities || [],
		report: opts.report || { summary: opts.summary || 'next.js app' },
		findings: opts.findings || [],
	};
}

describe('Phase 3 Learning Loop — 5 Mission Scenarios', () => {

	/* ════════════════════════════════════════════════════════════════
	 * MISSION 1: Agent discovers a recurring issue → Knowledge created
	 * ════════════════════════════════════════════════════════════════ */

	it('MISSION 1: discovers auth pattern and creates knowledge', () => {
		// Mission 1: Testing a Next.js + Clerk SaaS app
		const session1 = makeSession({
			id: 'session-m1',
			targetUrl: 'https://myapp.clerk.com',
			activities: [
				{ detail: 'Signed in via Clerk authentication', label: 'Auth' },
				{ detail: 'Tested login flow', label: 'Login' },
			],
			summary: 'next.js SaaS app with Clerk auth',
			findings: [],
		});

		// Agent discovers a real issue
		const findings = [
			{ id: 'f1', severity: 'high', title: 'Clerk authentication redirect fails on Safari browser', recommendation: 'Upgrade Clerk SDK' },
			{ id: 'f2', severity: 'medium', title: 'Login form does not show validation errors', recommendation: 'Add error messages' },
		];

		const results = writeKnowledge(findings, session1, 'mission-1');

		// Verify knowledge was created
		assert.equal(results.length, 2, 'should create 2 patterns');

		// Verify the auth pattern specifically
		const authPattern = results.find(r => r.pattern.pattern.includes('clerk'));
		assert.ok(authPattern, 'should have Clerk auth pattern');
		assert.equal(authPattern.action, 'created');
		assert.equal(authPattern.pattern.occurrences, 1);
		assert.equal(authPattern.pattern.sourceMissions[0].missionId, 'mission-1');
		assert.ok(authPattern.pattern.confidence > 0, 'confidence should be positive');

		// Verify provenance
		const provenance = getPatternProvenance(authPattern.pattern.id);
		assert.ok(provenance, 'provenance should exist');
		assert.equal(provenance.sourceMissions.length, 1);
	});

	/* ════════════════════════════════════════════════════════════════
	 * MISSION 2: Similar app → Knowledge retrieved → Hint injected → Validated
	 * ════════════════════════════════════════════════════════════════ */

	it('MISSION 2: retrieves knowledge for similar app and confirms pattern', () => {
		// First, seed knowledge from mission 1
		const session1 = makeSession({
			targetUrl: 'https://myapp.clerk.com',
			activities: [{ detail: 'Signed in via Clerk authentication', label: 'Auth' }],
			summary: 'next.js SaaS app with Clerk auth',
		});
		const seedFindings = [
			{ id: 'f1', severity: 'high', title: 'Clerk authentication redirect fails on Safari browser', recommendation: 'Upgrade Clerk SDK' },
		];
		writeKnowledge(seedFindings, session1, 'mission-1');

		// Mission 2: Different Next.js + Clerk app
		const session2Meta = detectAppMetadata({
			targetUrl: 'https://otherapp.clerk.com',
			capturedSteps: [],
			activities: [{ detail: 'Using Clerk for authentication', label: 'Auth' }],
			report: { summary: 'next.js SaaS' },
		});

		// Query knowledge for the new app
		const knowledgeResult = queryKnowledge(session2Meta);

		// Should find the Clerk auth pattern
		assert.ok(knowledgeResult.patterns.length >= 1, 'should find matching patterns');
		assert.ok(knowledgeResult.hints.length >= 1, 'should generate hints');

		const clerkHint = knowledgeResult.hints.find(h => h.pattern.toLowerCase().includes('clerk'));
		assert.ok(clerkHint, 'should have Clerk-specific hint');
		assert.ok(clerkHint.confidence > 0, 'hint should have confidence');
		assert.ok(clerkHint.relevance > 0, 'hint should have relevance score');

		// Verify hints are formatted as guidance, not directives
		const hintText = generateExplorationHints(knowledgeResult.patterns);
		assert.ok(hintText.includes('HISTORICAL SIGNAL'), 'should be marked as historical signal');
		assert.ok(hintText.includes('UNTRUSTED'), 'should be marked as untrusted');
		assert.ok(hintText.includes('NOT current facts'), 'should clarify these are not facts');

		// Agent validates the area and finds the same issue
		const session2 = makeSession({
			id: 'session-m2',
			targetUrl: 'https://otherapp.clerk.com',
			activities: [{ detail: 'Using Clerk for authentication', label: 'Auth' }],
			summary: 'next.js SaaS app',
			findings: [
				{ id: 'f2-1', severity: 'high', title: 'Clerk authentication redirect fails on Safari', recommendation: 'Fix redirect' },
			],
		});

		// Validate the knowledge against current findings
		const validations = validateKnowledge(knowledgeResult.patterns, session2, 'mission-2');
		assert.ok(validations.length >= 1, 'should validate patterns');

		// The Clerk auth pattern should be CONFIRMED (same issue found again)
		const clerkValidation = validations.find(v => v.pattern.includes('clerk'));
		assert.ok(clerkValidation, 'should have Clerk validation');
		assert.equal(clerkValidation.result, VALIDATION_RESULTS.CONFIRMED,
			'Clerk pattern should be CONFIRMED when same issue is found');
	});

	/* ════════════════════════════════════════════════════════════════
	 * MISSION 3: Same pattern again → Confidence increases
	 * ════════════════════════════════════════════════════════════════ */

	it('MISSION 3: repeated confirmation increases confidence', () => {
		// Seed: mission 1 creates the pattern
		const session1 = makeSession({
			targetUrl: 'https://app.clerk.com',
			activities: [{ detail: 'Clerk authentication login', label: 'Auth' }],
			summary: 'next.js SaaS',
		});
		const finding = { id: 'f1', severity: 'high', title: 'Clerk authentication redirect timeout on Safari', recommendation: 'Fix' };
		const m1Results = writeKnowledge([finding], session1, 'mission-1');
		const patternId = m1Results[0].pattern.id;
		const conf1 = m1Results[0].pattern.confidence;

		// Mission 2 confirms
		writeKnowledge([finding], session1, 'mission-2');
		const conf2 = getAllPatterns().find(p => p.id === patternId).confidence;

		// Mission 3 confirms again
		writeKnowledge([finding], session1, 'mission-3');
		const pattern3 = getAllPatterns().find(p => p.id === patternId);
		const conf3 = pattern3.confidence;

		// Verify confidence increased with more independent confirmations
		assert.ok(conf2 > conf1, `2nd occurrence (${conf2}) should increase from 1st (${conf1})`);
		assert.ok(conf3 > conf2, `3rd occurrence (${conf3}) should increase from 2nd (${conf2})`);
		assert.equal(pattern3.occurrences, 3, 'should have 3 occurrences');
		assert.equal(pattern3.sourceMissions.length, 3, 'should have 3 source missions');
	});

	/* ════════════════════════════════════════════════════════════════
	 * MISSION 4: Current evidence CONTRADICTS historical → Confidence decreases
	 * ════════════════════════════════════════════════════════════════ */

	it('MISSION 4: current evidence contradicts historical knowledge', () => {
		// Build up a high-confidence pattern from 3 missions
		const session = makeSession({
			targetUrl: 'https://app.clerk.com',
			activities: [{ detail: 'Clerk authentication', label: 'Auth' }],
			summary: 'next.js SaaS app',
		});
		const finding = { id: 'f1', severity: 'high', title: 'Clerk authentication redirect fails on Safari', recommendation: 'Fix' };
		writeKnowledge([finding], session, 'm1');
		writeKnowledge([finding], session, 'm2');
		writeKnowledge([finding], session, 'm3');

		const pattern = getAllPatterns()[0];
		const highConfidence = pattern.confidence;
		assert.ok(highConfidence > 0.3, `pre-contradiction confidence should be substantial: ${highConfidence}`);

		// Now query knowledge for the new mission
		const knowledgeResult = queryKnowledge(detectAppMetadata(session));

		// Mission 4: The issue is FIXED — agent verifies login works correctly
		const session4 = makeSession({
			id: 'session-m4',
			targetUrl: 'https://app.clerk.com',
			activities: [{ detail: 'Clerk authentication works', label: 'Auth' }],
			summary: 'next.js SaaS app with working auth',
			findings: [], // No auth-related findings
			capturedSteps: [
				{ url: 'https://app.clerk.com/login', label: 'Login page', outcome: { status: 'success', urlAfter: 'https://app.clerk.com/dashboard', titleAfter: 'Dashboard' } },
				{ url: 'https://app.clerk.com/login', label: 'Clerk authentication redirect success', outcome: { status: 'success' } },
			],
		});

		// Detect conflicts
		const appModel = {
			understanding: {
				features: {
					verified: [{ name: 'login' }],
					observed: [],
				},
			},
		};
		const conflicts = detectKnowledgeConflicts(knowledgeResult.patterns, appModel, session4.findings);

		// Should detect the conflict
		assert.ok(conflicts.length >= 1, 'should detect conflict');
		const authConflict = conflicts.find(c => c.pattern.toLowerCase().includes('clerk') || c.pattern.toLowerCase().includes('login'));
		assert.ok(authConflict, 'should have auth-related conflict');
		assert.equal(authConflict.resolution, 'current_evidence_wins', 'current evidence must win');

		// Validate: CONTRADICTED
		const validations = validateKnowledge(knowledgeResult.patterns, session4, 'm4');
		const authVal = validations.find(v => v.pattern.includes('clerk') || v.pattern.includes('login'));
		assert.ok(authVal, 'should validate auth pattern');

		// Verify confidence decreased after contradiction
		const afterPattern = getAllPatterns().find(p => p.id === pattern.id);
		assert.ok(afterPattern.confidence < highConfidence,
			`confidence after contradiction (${afterPattern.confidence}) should be < before (${highConfidence})`);
	});

	/* ════════════════════════════════════════════════════════════════
	 * MISSION 5: NOT_TESTED — area was not reached, NOT marked as broken
	 * ════════════════════════════════════════════════════════════════ */

	it('MISSION 5: untested area is NOT_TESTED, not marked as broken', () => {
		// Create knowledge about password reset
		const session = makeSession({
			summary: 'next.js SaaS app with Clerk auth',
		});
		writeKnowledge([{
			id: 'f1', severity: 'high',
			title: 'Password reset flow is completely broken and sends no email',
			recommendation: 'Fix email service',
		}], session, 'm1');

		const pattern = getAllPatterns()[0];
		const originalConf = pattern.confidence;

		// Mission 5: Tests a completely different area (dashboard)
		const session5 = makeSession({
			id: 'session-m5',
			findings: [
				{ id: 'f5-1', severity: 'medium', title: 'Dashboard chart rendering is slow on initial load', recommendation: 'Optimize' },
			],
			capturedSteps: [
				{ url: 'https://app.example.com/dashboard', label: 'Dashboard', outcome: { status: 'success' } },
			],
			summary: 'Tested dashboard charts and analytics',
		});

		const knowledgeResult = queryKnowledge(detectAppMetadata(session));
		const validations = validateKnowledge(knowledgeResult.patterns, session5, 'm5');

		// Password reset pattern should be NOT_TESTED
		const pwResetVal = validations.find(v => v.pattern.includes('password'));
		assert.ok(pwResetVal, 'should validate password reset pattern');
		assert.equal(pwResetVal.result, VALIDATION_RESULTS.NOT_TESTED,
			'unreached pattern area should be NOT_TESTED');

		// NOT_TESTED should NOT decrease confidence as much as CONTRADICTED
		const afterPattern = getAllPatterns().find(p => p.id === pattern.id);
		const notTestedConf = afterPattern.confidence;

		// Contrast: simulate what CONTRADICTED would look like
		const contradictedCopy = {
			...pattern,
			validations: [...pattern.validations, { result: VALIDATION_RESULTS.CONTRADICTED }],
		};
		const contradictedConf = calculateConfidence(contradictedCopy);

		assert.ok(notTestedConf >= contradictedConf,
			`NOT_TESTED confidence (${notTestedConf}) should be >= CONTRADICTED (${contradictedConf})`);
	});

	/* ════════════════════════════════════════════════════════════════
	 * FULL LOOP: Knowledge stats after 5 missions
	 * ════════════════════════════════════════════════════════════════ */

	it('FULL LOOP: knowledge accumulates across 5 diverse missions', () => {
		// Mission 1: SaaS app with auth issue
		writeKnowledge(
			[{ id: 'f1', severity: 'high', title: 'Clerk authentication redirect timeout on Safari', recommendation: 'Fix' }],
			makeSession({ targetUrl: 'https://app1.clerk.com', summary: 'next.js SaaS', activities: [{ detail: 'Clerk auth', label: 'Auth' }] }),
			'm1'
		);

		// Mission 2: Ecommerce with checkout issue
		writeKnowledge(
			[{ id: 'f2', severity: 'critical', title: 'Checkout payment form validation fails on submit', recommendation: 'Fix validation' }],
			makeSession({ targetUrl: 'https://shop.example.com', summary: 'ecommerce store with checkout cart', activities: [{ detail: 'Shopping cart checkout', label: 'Checkout' }] }),
			'm2'
		);

		// Mission 3: Same auth issue in different app
		writeKnowledge(
			[{ id: 'f3', severity: 'high', title: 'Clerk authentication redirect timeout on Safari', recommendation: 'Fix' }],
			makeSession({ targetUrl: 'https://app2.clerk.com', summary: 'next.js SaaS', activities: [{ detail: 'Clerk auth', label: 'Auth' }] }),
			'm3'
		);

		// Mission 4: Dashboard with performance issue
		writeKnowledge(
			[{ id: 'f4', severity: 'medium', title: 'Dashboard chart rendering is slow on initial page load', recommendation: 'Optimize' }],
			makeSession({ targetUrl: 'https://analytics.example.com', summary: 'analytics dashboard', activities: [{ detail: 'Dashboard charts', label: 'Dashboard' }] }),
			'm4'
		);

		// Mission 5: Same auth issue again (3rd time)
		writeKnowledge(
			[{ id: 'f5', severity: 'high', title: 'Clerk authentication redirect timeout on Safari', recommendation: 'Fix' }],
			makeSession({ targetUrl: 'https://app3.clerk.com', summary: 'next.js SaaS', activities: [{ detail: 'Clerk auth', label: 'Auth' }] }),
			'm5'
		);

		const allPatterns = getAllPatterns();
		const stats = getKnowledgeStats();

		// Should have patterns from different categories
		assert.ok(allPatterns.length >= 3, `should have at least 3 patterns, got ${allPatterns.length}`);

		// The auth pattern should be accumulated (3 occurrences)
		const authPattern = allPatterns.find(p => p.pattern.includes('clerk'));
		assert.ok(authPattern, 'should have auth pattern');
		assert.equal(authPattern.occurrences, 3, 'auth pattern should have 3 occurrences');
		assert.equal(authPattern.sourceMissions.length, 3, 'should have 3 source missions');

		// Verify category diversity
		const categories = new Set(allPatterns.map(p => p.category));
		assert.ok(categories.size >= 2, 'should have patterns from multiple categories');

		// Verify stats
		assert.ok(stats.total >= 3);
		assert.ok(stats.active >= 3);
		assert.ok(stats.avgConfidence > 0);
	});
});
