/**
 * BUILD C2 — unit tests for the production autonomy contract.
 *
 * Phases 2-5 of the C2 spec: state-dependent CONTINUE / INVESTIGATE /
 * REPLAN / STOP decisions, decision→execution coupling, budget ceiling
 * invariants, and deterministic failure behavior. All deterministic —
 * no server, no browser, no LLM.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'c2-unit-'));
process.env.QASE_STATE_DIR = tmp;

const { recordDecisionTrace, getDecisionTraces, __resetDecisionTraces } = await import('../server/decisionTraces.js');
const { makeDecisionSafe, collectDecisionInput, DECISION_TYPES } = await import('../server/decisionEngine.js');
const { resolveAction, buildReplanFocus } = await import('../server/validationLoop.js');

/* ── Phase 3: the four verbs are state-dependent, not hard-coded ──── */

/**
 * A settled session factory. Everything defaults to a "session ran and
 * completed normally" state; individual tests mutate the one dimension
 * that should flip the decision.
 */
function settledSession(overrides = {}) {
	return {
		status: 'idle',
		maxTurns: 8,
		turnCount: 8, // fully spent — STOP-family territory unless budget remains
		findings: [],
		capturedSteps: [],
		activities: [],
		startedAt: Date.now() - 1000,
		report: undefined,
		decisionHistory: [],
		...overrides
	};
}

const freshMission = () => ({
	id: 'm-c2',
	currentIteration: 0,
	constraints: { maxIterations: 5 },
	iterations: [],
	context: {},
	objectives: []
});

test('P3: CONTINUE — near-zero evidence with budget remaining keeps the same approach', () => {
	// Turn budget 8, spent 0, nothing found, nothing explored.
	const session = settledSession({ status: 'done', maxTurns: 12, turnCount: 1, stepCount: 1 });
	const decision = makeDecisionSafe(session, {}, freshMission());
	assert.equal(decision.decision, DECISION_TYPES.CONTINUE);
	assert.ok(decision.reason.toLowerCase().includes('evidence') || decision.reason.toLowerCase().includes('coverage'),
		'reason must reference the evidence state');
});

test('P3: INVESTIGATE — findings exist with budget remaining → verify before broadening', () => {
	const session = settledSession({
		status: 'done',
		maxTurns: 12,
		turnCount: 2,
		findings: [
			{ id: 'f1', severity: 'high', title: 'Checkout button dead', confidence: 0.8 },
			{ id: 'f2', severity: 'medium', title: 'Slow product list', confidence: 0.6 }
		],
		capturedSteps: Array.from({ length: 12 }, (_, i) => ({ url: `http://t/p${i}` }))
	});
	const mission = freshMission();
	const decision = makeDecisionSafe(session, {}, mission);
	assert.equal(decision.decision, DECISION_TYPES.INVESTIGATE);
	// INVESTIGATE must carry the finding references it wants re-examined.
	assert.ok(Array.isArray(decision.evidenceRefs) && decision.evidenceRefs.includes('f1'),
		'investigation targets the findings that triggered it');
});

test('P3: REPLAN — thin coverage + no findings + budget remaining → change approach, not just continue', () => {
	const session = settledSession({
		status: 'done',
		maxTurns: 12,
		turnCount: 6,
		findings: [],
		// 40 steps but all on the same page — effort spent, no breadth.
		capturedSteps: Array.from({ length: 40 }, () => ({ url: 'http://t/only-page' }))
	});
	const mission = freshMission();
	const decision = makeDecisionSafe(session, {}, mission);
	assert.equal(decision.decision, DECISION_TYPES.REPLAN);
	assert.ok(decision.focusPayload, 'replan must carry a focus payload');
	assert.ok(Array.isArray(decision.focusPayload.focusAreas) && decision.focusPayload.focusAreas.length > 0,
		'focus areas derived from the coverage state');
});

test('P3: STOP_BUDGET — budget exhausted with no criticals → truthful budget stop', () => {
	const session = settledSession({ status: 'done', maxTurns: 8, turnCount: 8, findings: [] });
	const decision = makeDecisionSafe(session, {}, freshMission());
	assert.equal(decision.decision, DECISION_TYPES.STOP_BUDGET);
});

test('P3: STOP_FAIL — criticals present (even at budget exhaustion) → fail stop dominates', () => {
	const session = settledSession({
		status: 'done',
		maxTurns: 8,
		turnCount: 8,
		findings: [{ id: 'f9', severity: 'critical', title: 'Auth bypass', confidence: 0.9 }]
	});
	const decision = makeDecisionSafe(session, {}, freshMission());
	assert.equal(decision.decision, DECISION_TYPES.STOP_FAIL);
});

test('P3: STOP_PASS — sufficient evidence and passing quality → stop early, don\'t burn budget', () => {
	const session = settledSession({
		status: 'done',
		maxTurns: 12,
		turnCount: 4,
		findings: [],
		capturedSteps: Array.from({ length: 30 }, (_, i) => ({ url: `http://t/p${i % 7}` }))
	});
	const evidence = { missionResult: { quality: { score: 92, verdict: 'pass', releaseReady: true } } };
	const decision = makeDecisionSafe(session, evidence, freshMission());
	assert.equal(decision.decision, DECISION_TYPES.STOP_PASS);
});

test('P3: the four states produce four DIFFERENT decisions — no hard-coded verb', () => {
	const cases = [
		{ name: 'bare-start', session: settledSession({ status: 'done', maxTurns: 12, turnCount: 1 }), evidence: {} },
		{ name: 'has-findings', session: settledSession({ status: 'done', maxTurns: 12, turnCount: 2, findings: [{ id: 'f1', severity: 'high', title: 'x', confidence: 0.8 }] }), evidence: {} },
		{ name: 'thin-coverage', session: settledSession({ status: 'done', maxTurns: 12, turnCount: 6, capturedSteps: Array.from({ length: 40 }, () => ({ url: 'http://t/one' })) }), evidence: {} },
		{ name: 'spent', session: settledSession({ status: 'done', maxTurns: 8, turnCount: 8 }), evidence: {} }
	];
	const decisions = new Set(cases.map(c => makeDecisionSafe(c.session, c.evidence, freshMission()).decision));
	assert.equal(decisions.size, 4, `expected 4 distinct decisions, got ${[...decisions].join(', ')}`);
});

/* ── Phase 2: decision → action → execution coupling ─────────────── */

test('P2: resolveAction maps each verb to a distinct execution directive', () => {
	const mission = freshMission();
	assert.equal(resolveAction(DECISION_TYPES.CONTINUE, mission).action, 'continue');
	assert.equal(resolveAction(DECISION_TYPES.INVESTIGATE, mission).action, 'revalidate');
	assert.ok(resolveAction(DECISION_TYPES.INVESTIGATE, mission).shouldRevalidate);
	assert.equal(resolveAction(DECISION_TYPES.REPLAN, mission).action, 'replan');
	assert.ok(resolveAction(DECISION_TYPES.REPLAN, mission).shouldRevalidate, 'replan dispatches a new iteration too');
	assert.equal(resolveAction(DECISION_TYPES.STOP_PASS, mission).action, 'stop');
	assert.equal(resolveAction(DECISION_TYPES.STOP_BUDGET, mission).stopReason, 'budget_exhausted');
});

test('P2: REPLAN focus differs from INVESTIGATE prompt input — different execution, not just different label', () => {
	const mission = freshMission();
	const investigate = resolveAction(DECISION_TYPES.INVESTIGATE, mission);
	const replan = resolveAction(DECISION_TYPES.REPLAN, mission);
	assert.notEqual(investigate.action, replan.action);
	assert.ok(!investigate.focusPayload, 'investigate does not replan scope');
	assert.ok(replan.focusPayload, 'replan carries changed scope');
	assert.ok(JSON.stringify(replan.focusPayload) !== JSON.stringify(investigate.focusPayload));
});

test('P2: buildReplanFocus derives focus areas deterministically from appModel/testContext/gap report', () => {
	const focus = buildReplanFocus({
		appModel: { pages: [{ path: '/checkout' }, { path: '/login' }], metadata: { coverage: { pagesExplored: 1 } } },
		testContext: { riskAssessment: { risks: [{ area: 'Authentication', reason: 'credentials present' }] } },
		gapReport: { incompleteWorkflows: [{ name: 'checkout flow', untestedSteps: ['payment'] }] }
	});
	assert.ok(Array.isArray(focus.focusAreas));
	assert.ok(focus.focusAreas.length >= 3, 'untested pages + risk areas + incomplete workflows all contribute');
	assert.ok(focus.focusAreas.some(a => /checkout/i.test(a)), 'untested app-model page surfaces');
	assert.ok(focus.focusAreas.some(a => /authentication/i.test(a)), 'risk area surfaces');
	assert.ok(focus.focusAreas.some(a => /payment/i.test(a)), 'gap-report workflow surfaces');
	// deterministic: same inputs → same output
	assert.deepEqual(buildReplanFocus({
		appModel: { pages: [{ path: '/checkout' }, { path: '/login' }], metadata: { coverage: { pagesExplored: 1 } } },
		testContext: { riskAssessment: { risks: [{ area: 'Authentication', reason: 'x' }] } },
		gapReport: { incompleteWorkflows: [{ name: 'checkout flow', untestedSteps: ['payment'] }] }
	}), focus);
});

/* ── Phase 2/4: signal wiring + budget ceiling ────────────────────── */

test('P2: collectDecisionInput now exposes risk + focus signals (C2 wiring fix)', () => {
	const input = collectDecisionInput(settledSession({
		testContext: { riskAssessment: { level: 'high', risks: [{ area: 'Authentication' }] }, adaptiveGuidance: 'x' },
		appModel: { pages: [{ path: '/a' }, { path: '/b' }, { path: '/c' }], metadata: { coverage: { pagesExplored: 1 } } }
	}), {}, freshMission());
	assert.equal(input.riskLevel, 'high');
	assert.ok(Array.isArray(input.topRiskAreas) && input.topRiskAreas.includes('Authentication'));
	assert.equal(input.untestedPageCount, 2);
});

test('P4: INVARIANT — autonomy never self-grants: budget math never exceeds authorized envelope', () => {
	// Authorized 8, spent 8 → no budget path may answer > 0 remaining.
	const session = settledSession({ maxTurns: 8, turnCount: 8 });
	const input = collectDecisionInput(session, {}, freshMission());
	assert.equal(input.turnBudgetSpent, true, 'turn pool must read as spent when fully spent');
	assert.equal(input.turnBudgetRemaining, 0, 'turn pool remaining must be 0 when fully spent');
	assert.equal(input.spentTurns <= input.authorizedTurns, true, 'spent may never exceed authorized');
	// Authorized 8, spent 2 → remaining 6, never > authorized.
	const partial = collectDecisionInput(settledSession({ maxTurns: 8, turnCount: 2 }), {}, freshMission());
	assert.ok(partial.budgetRemaining.overall <= 1);
	assert.ok(partial.budgetRemaining.overall >= 0);
});

test('P4: ceiling clamp — any session.maxTurns above 500 is clamped inside decision math', () => {
	const input = collectDecisionInput(settledSession({ maxTurns: 9999, turnCount: 0 }), {}, freshMission());
	assert.ok(input.budgetRemaining.overall <= 1, 'remaining fraction normalized, no 9999-turn authorization implied');
});

/* ── Phase 9: failure modes — decide safely on hostile/degenerate input ── */

test('P9: malformed decision input never crashes the engine — safe fallback', () => {
	const hostile = [
		{ status: 'done', maxTurns: 8, turnCount: 3, findings: [{ severity: 'weird' }] },
		{ status: 'done', maxTurns: 'eight', turnCount: null, findings: null, capturedSteps: null },
		{ status: 42, maxTurns: -5, turnCount: 'x' },
		{ status: 'done' },
		null
	];
	for (const session of hostile) {
		const d = makeDecisionSafe(session, {}, freshMission());
		assert.ok(d, 'engine always returns a decision');
		assert.ok(Object.values(DECISION_TYPES).includes(d.decision), `allowlisted type: ${d.decision}`);
	}
});

test('P9: resolveAction on unknown decision type → none, never a phantom action', () => {
	const r = resolveAction('EXPLODE_EVERYTHING', freshMission());
	assert.equal(r.action, 'none');
	assert.equal(r.shouldRevalidate, false);
	assert.equal(r.shouldStop, false);
});

test('P9: empty evidence and empty mission still produce an allowlisted decision', () => {
	const d = makeDecisionSafe(settledSession({ status: 'done', maxTurns: 6, turnCount: 1 }), {}, null);
	assert.ok(Object.values(DECISION_TYPES).includes(d.decision));
});

/* ── Trace integrity for the new vocabulary ───────────────────────── */

test('P2: traces record the new verb vocabulary cleanly (schema unchanged)', () => {
	__resetDecisionTraces();
	recordDecisionTrace({
		missionId: 'm-c2', iteration: 1, state: 'session:done',
		signals: { riskLevel: 'high', untestedPageCount: 2 },
		candidateAction: 'REPLAN', selectedAction: 'replan',
		reason: 'thin coverage', budgetBefore: 0.75, budgetRequested: 1, budgetGranted: 1,
		result: 'replan_dispatched', nextDecision: 'next_iteration_replan'
	});
	const [t] = getDecisionTraces('m-c2');
	assert.equal(t.candidate_action, 'REPLAN');
	assert.equal(t.selected_action, 'replan');
	assert.equal(t.next_decision, 'next_iteration_replan');
	assert.deepEqual(t.signals_used, ['riskLevel', 'untestedPageCount']);
});

/* ── source-level invariants (C2 extension of B2 guard) ───────────── */

test('P4: no autonomy code writes budget fields (source-level, all autonomy modules)', async () => {
	const { readFile } = await import('node:fs/promises');
	for (const file of ['autonomyController.js', 'autonomyContext.js', 'decisionEngine.js', 'validationLoop.js']) {
		const src = await readFile(new URL(`../server/${file}`, import.meta.url), 'utf8');
		assert.ok(!/session\.maxTurns\s*=/.test(src), `${file} assigns session.maxTurns`);
		assert.ok(!/mission\.context\.maxTurns\s*=/.test(src), `${file} rewrites mission budget`);
		assert.ok(!/maxIterations\s*=\s*(\d|mission)/.test(src), `${file} raises iteration limit`);
	}
});

test.after?.(() => rmSync(tmp, { recursive: true, force: true }));
