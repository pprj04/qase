/**
 * Tests for Mission Architecture + Continuous Validation Loop
 * Covers: missions store, evidence engine, quality scoring, compareIterations,
 * product-facing quality, and iteration recording.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// --- Under test ---
import {
	createMission, getMission, listMissions, updateMission,
	deleteMission, recordIteration, getComparisonIterations,
	loadMissionsFromDisk
} from '../server/missions.js';
import {
	scoreFindingQuality, calculateMissionQuality, compareIterations,
	buildImprovementPrompt
} from '../server/devIntelligence.js';

/* ── Helpers ── */

function makeFinding(overrides = {}) {
	return {
		id: overrides.id || randomUUID(),
		title: overrides.title || 'Test finding',
		severity: overrides.severity || 'medium',
		category: overrides.category || 'general',
		url: overrides.url || '/test',
		expected: overrides.expected || 'Should work',
		actual: overrides.actual || 'Did not work',
		steps: overrides.steps || ['Step 1', 'Step 2'],
		evidence: overrides.evidence || 'Console error: foo',
		confidence: overrides.confidence,
		observed: overrides.observed,
		impact: overrides.impact,
		recommendation: overrides.recommendation,
		reproducibility: overrides.reproducibility,
		...overrides
	};
}

const testMissionIds = [];

function createTestMission(data = {}) {
	const m = createMission({
		name: 'Test Mission',
		targetUrl: 'https://test.example.com',
		type: 'full_audit',
		autoStart: false,
		...data
	});
	testMissionIds.push(m.id);
	return m;
}

/* ── Mission Store ── */

describe('Mission Store', () => {
	it('creates a mission with defaults', () => {
		const m = createTestMission();
		assert.ok(m.id);
		assert.equal(m.status, 'created');
		assert.equal(m.type, 'full_audit');
		assert.deepEqual(m.iterations, []);
		assert.equal(m.currentIteration, 0);
		assert.equal(m.qualityScore, null);
		assert.equal(m.verdict, null);
		assert.ok(m.createdAt);
	});

	it('creates a mission with custom type', () => {
		const m = createTestMission({ type: 'security' });
		assert.equal(m.type, 'security');
	});

	it('defaults unknown type to full_audit', () => {
		const m = createTestMission({ type: 'nonexistent' });
		assert.equal(m.type, 'full_audit');
	});

	it('gets a mission by id', () => {
		const m = createTestMission();
		assert.deepEqual(getMission(m.id), m);
	});

	it('returns null for missing mission', () => {
		assert.equal(getMission('nonexistent-id'), null);
	});

	it('lists missions', () => {
		const m1 = createTestMission({ name: 'A' });
		const m2 = createTestMission({ name: 'B' });
		const list = listMissions({});
		const ids = list.map(x => x.id);
		assert.ok(ids.includes(m1.id));
		assert.ok(ids.includes(m2.id));
	});

	it('updates a mission', () => {
		const m = createTestMission();
		const updated = updateMission(m.id, { status: 'running', qualityScore: 85 });
		assert.equal(updated.status, 'running');
		assert.equal(updated.qualityScore, 85);
	});

	it('rejects unknown update fields', () => {
		const m = createTestMission();
		const updated = updateMission(m.id, { hackerField: 'pwned' });
		assert.equal(updated.hackerField, undefined);
	});

	it('deletes a mission', () => {
		const m = createTestMission();
		assert.equal(deleteMission(m.id), true);
		assert.equal(getMission(m.id), null);
	});

	it('returns false deleting nonexistent mission', () => {
		assert.equal(deleteMission('nonexistent'), false);
	});
});

/* ── Iterations ── */

describe('Mission Iterations', () => {
	it('records an iteration and increments counter', () => {
		const m = createTestMission();
		const result = recordIteration(m.id, {
			sessionId: 's1',
			findings: [makeFinding()],
			qualityScore: 80,
			verdict: 'pass_with_issues'
		});
		assert.equal(result.currentIteration, 1);
		assert.equal(result.iterations.length, 1);
		assert.equal(result.iterations[0].number, 1);
		assert.equal(result.iterations[0].sessionId, 's1');
	});

	it('records multiple iterations', () => {
		const m = createTestMission();
		recordIteration(m.id, { sessionId: 's1', findings: [], qualityScore: 60 });
		recordIteration(m.id, { sessionId: 's2', findings: [], qualityScore: 80 });
		const result = getMission(m.id);
		assert.equal(result.currentIteration, 2);
		assert.equal(result.iterations.length, 2);
	});

	it('prevents double-recording same session', () => {
		const m = createTestMission();
		recordIteration(m.id, { sessionId: 's1', findings: [], qualityScore: 60 });
		recordIteration(m.id, { sessionId: 's1', findings: [], qualityScore: 80 });
		const result = getMission(m.id);
		assert.equal(result.currentIteration, 1); // Should stay at 1
		assert.equal(result.iterations.length, 1);
	});

	it('getComparisonIterations returns last two', () => {
		const m = createTestMission();
		recordIteration(m.id, { sessionId: 's1', findings: [{ title: 'A' }] });
		recordIteration(m.id, { sessionId: 's2', findings: [{ title: 'B' }] });
		const pair = getComparisonIterations(m.id);
		assert.equal(pair.previous.findings[0].title, 'A');
		assert.equal(pair.current.findings[0].title, 'B');
	});

	it('getComparisonIterations returns null with < 2 iterations', () => {
		const m = createTestMission();
		assert.equal(getComparisonIterations(m.id), null);
		recordIteration(m.id, { sessionId: 's1', findings: [] });
		assert.equal(getComparisonIterations(m.id), null);
	});
});

/* ── Evidence Engine ── */

describe('Evidence Engine Fields', () => {
	it('scoreFindingQuality assigns confidence from evidence richness', () => {
		const f = makeFinding({
			confidence: undefined,
			expected: 'X', actual: 'Y',
			steps: ['a', 'b'], evidence: 'err', observed: 'Z'
		});
		const result = scoreFindingQuality(f, [f]);
		assert.ok(result.confidence > 0.5);
		assert.equal(result.reproducibility, 'confirmed');
	});

	it('scoreFindingQuality uses agent-provided confidence when present', () => {
		const f = makeFinding({ confidence: 0.95 });
		const result = scoreFindingQuality(f, [f]);
		assert.equal(result.confidence, 0.95);
	});

	it('detects duplicates by normalized title + url', () => {
		const f1 = makeFinding({ id: '1', title: 'Login Broken!', url: '/login' });
		const f2 = makeFinding({ id: '2', title: 'login broken', url: '/login' });
		const all = [f1, f2];
		const s1 = scoreFindingQuality(f1, all);
		const s2 = scoreFindingQuality(f2, all);
		assert.equal(s1.isDuplicate, false); // First is original
		assert.equal(s2.isDuplicate, true);  // Second is dup
		assert.equal(s2.duplicateOf, '1');
	});

	it('does not mark different URLs as duplicates', () => {
		const f1 = makeFinding({ id: '1', title: 'Login broken', url: '/login' });
		const f2 = makeFinding({ id: '2', title: 'Login broken', url: '/admin' });
		const all = [f1, f2];
		assert.equal(scoreFindingQuality(f1, all).isDuplicate, false);
		assert.equal(scoreFindingQuality(f2, all).isDuplicate, false);
	});
});

/* ── Quality Scoring ── */

describe('calculateMissionQuality', () => {
	it('returns perfect score for no findings', () => {
		const q = calculateMissionQuality([]);
		assert.equal(q.score, 100);
		assert.equal(q.verdict, 'pass');
		assert.equal(q.releaseReady, true);
		assert.equal(q.risk, 'low');
	});

	it('penalizes critical findings heavily', () => {
		const q = calculateMissionQuality([makeFinding({ severity: 'critical', confidence: 0.9 })]);
		assert.ok(q.score < 80);
		assert.equal(q.verdict, 'fail');
		assert.equal(q.releaseReady, false);
		assert.equal(q.risk, 'high');
	});

	it('passes with minor issues', () => {
		const q = calculateMissionQuality([makeFinding({ severity: 'low', confidence: 0.5 })]);
		assert.ok(q.score >= 85);
		assert.equal(q.verdict, 'pass');
		assert.equal(q.risk, 'low');
	});

	it('produces product-facing fields', () => {
		const q = calculateMissionQuality([makeFinding({ severity: 'high', confidence: 0.8 })]);
		assert.ok(typeof q.confidence === 'number');
		assert.ok(['low', 'medium', 'high'].includes(q.risk));
		assert.ok(Array.isArray(q.criticalIssues));
		assert.ok(Array.isArray(q.recommendations));
	});

	it('recommendations are sorted by severity', () => {
		const findings = [
			makeFinding({ id: '1', severity: 'low' }),
			makeFinding({ id: '2', severity: 'critical' }),
			makeFinding({ id: '3', severity: 'medium' })
		];
		const q = calculateMissionQuality(findings);
		assert.equal(q.recommendations[0].priority, 'critical');
	});
});

/* ── compareIterations ── */

describe('compareIterations', () => {
	it('identifies fixed findings', () => {
		const prev = [
			makeFinding({ title: 'Bug A', url: '/a' }),
			makeFinding({ title: 'Bug B', url: '/b' })
		];
		const curr = [
			makeFinding({ title: 'Bug A', url: '/a' })
		];
		const result = compareIterations(prev, curr);
		assert.equal(result.fixedCount, 1);
		assert.equal(result.fixed[0].title, 'Bug B');
	});

	it('identifies remaining findings', () => {
		const prev = [makeFinding({ title: 'Bug A', url: '/a' })];
		const curr = [makeFinding({ title: 'Bug A', url: '/a' })];
		const result = compareIterations(prev, curr);
		assert.equal(result.remainingCount, 1);
		assert.equal(result.fixedCount, 0);
		assert.equal(result.newRegressionCount, 0);
	});

	it('identifies new regressions', () => {
		const prev = [makeFinding({ title: 'Bug A', url: '/a' })];
		const curr = [
			makeFinding({ title: 'Bug A', url: '/a' }),
			makeFinding({ title: 'New Bug', url: '/new' })
		];
		const result = compareIterations(prev, curr);
		assert.equal(result.newRegressionCount, 1);
		assert.equal(result.newRegressions[0].title, 'New Bug');
	});

	it('trend improving when score increases', () => {
		const prev = [makeFinding({ severity: 'critical', confidence: 0.9 })];
		const curr = [makeFinding({ severity: 'low', confidence: 0.5 })];
		const result = compareIterations(prev, curr);
		assert.equal(result.trend, 'improving');
		assert.ok(result.scoreDelta > 5);
	});

	it('trend declining when new critical appears', () => {
		const prev = [];
		const curr = [makeFinding({ severity: 'critical', confidence: 0.9 })];
		const result = compareIterations(prev, curr);
		assert.equal(result.trend, 'declining');
	});

	it('trend stable when identical', () => {
		const findings = [makeFinding({ severity: 'medium', confidence: 0.5 })];
		const result = compareIterations(findings, findings);
		assert.equal(result.trend, 'stable');
	});

	it('approveRecommended true when improving and release-ready', () => {
		const prev = [makeFinding({ severity: 'high', confidence: 0.8 })];
		const curr = [makeFinding({ severity: 'low', confidence: 0.3 })];
		const result = compareIterations(prev, curr);
		assert.equal(result.approveRecommended, true);
	});

	it('approveRecommended false with new critical regression', () => {
		const prev = [makeFinding({ severity: 'low', confidence: 0.3 })];
		const curr = [makeFinding({ severity: 'critical', confidence: 0.9 })];
		const result = compareIterations(prev, curr);
		assert.equal(result.approveRecommended, false);
	});

	it('matches findings case-insensitively', () => {
		const prev = [makeFinding({ title: 'Button Clicks Fail!', url: '/btn' })];
		const curr = [makeFinding({ title: 'button clicks fail', url: '/btn' })];
		const result = compareIterations(prev, curr);
		assert.equal(result.remainingCount, 1);
		assert.equal(result.fixedCount, 0);
	});
});

/* ── AI Studio Contract ── */

describe('buildImprovementPrompt', () => {
	it('produces structured output with fixPrompt per finding', () => {
		const mission = { targetUrl: 'https://app.com', type: 'full_audit' };
		const findings = [makeFinding({ severity: 'critical' })];
		const report = buildImprovementPrompt(mission, findings);
		assert.ok(report.verdict);
		assert.ok(typeof report.qualityScore === 'number');
		assert.ok(report.findings.every(f => Boolean(f.fixPrompt)));
		assert.ok(typeof report.improvementPrompt === 'string');
		assert.ok('regressionReady' in report);
	});

	it('improvement prompt contains target URL', () => {
		const mission = { targetUrl: 'https://myapp.com', type: 'security' };
		const report = buildImprovementPrompt(mission, []);
		assert.ok(report.improvementPrompt.includes('myapp.com'));
	});
});
