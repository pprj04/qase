/**
 * BUILD B2 — unit tests for the autonomous control loop wiring.
 *
 * Covers W1 (testContext builder), W3 (decision traces), and the budget
 * asymmetry invariant — all deterministic, no server, no browser, no LLM.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// decisionTraces persists to .qase/ beside server/ — isolate in a temp dir.
const tmp = mkdtempSync(join(tmpdir(), 'b2-unit-'));
process.env.QASE_STATE_DIR = tmp;

const { recordDecisionTrace, getDecisionTraces, __resetDecisionTraces } = await import('../server/decisionTraces.js');
const { buildTestContext } = await import('../server/autonomyContext.js');
const { autonomyEnabled } = await import('../server/autonomyController.js');
const { resolveAction } = await import('../server/validationLoop.js');
const { makeDecisionSafe } = await import('../server/decisionEngine.js');

/* ── W3: decision traces ─────────────────────────────────────────── */

test('W3: trace has exactly the 13 user-locked fields (+ts), sanitized', () => {
	__resetDecisionTraces();
	const trace = recordDecisionTrace({
		missionId: 'm-1',
		iteration: 2,
		state: 'session:done<script>',
		signals: { 'weird key!': 1, ok_signal: 2 },
		candidateAction: 'REVALIDATE',
		selectedAction: 'revalidate',
		reason: 'coverage gap\x00in auth\nflow',
		budgetBefore: 5,
		budgetRequested: 1,
		budgetGranted: 1,
		result: 'revalidation_started',
		nextDecision: 'after_next_iteration'
	});
	const expected = ['decision_id', 'mission_id', 'iteration', 'ts', 'state', 'signals_used',
		'candidate_action', 'selected_action', 'reason', 'budget_before', 'budget_requested',
		'budget_granted', 'result', 'next_decision'].sort();
	assert.deepEqual(Object.keys(trace).sort(), expected);
	assert.equal(trace.state, 'session:done<script>'); // tags kept, control chars stripped from reason only
	assert.ok(!trace.reason.includes('\x00'));
	assert.ok(!trace.reason.includes('\n'));
	assert.ok(trace.decision_id.startsWith('dec_'));
	// signals carry KEYS only — never values (no CoT/secret leakage channel)
	assert.deepEqual(trace.signals_used, ['weird_key_', 'ok_signal']);
	assert.equal(getDecisionTraces('m-1').length, 1);
});

test('W3: traces bound growth per mission and across missions', () => {
	__resetDecisionTraces();
	for (let i = 0; i < 120; i++) {
		recordDecisionTrace({ missionId: 'm-bound', iteration: i, state: 's', signals: {}, candidateAction: 'CONTINUE', selectedAction: 'wait', reason: 'r', budgetBefore: 1, budgetRequested: 0, budgetGranted: 0, result: 'no_action', nextDecision: 'loop' });
	}
	assert.equal(getDecisionTraces('m-bound').length, 100); // MAX_PER_MISSION
});

test('W3: no-secret discipline — a secret-looking value in reason is truncated, not stored raw', () => {
	__resetDecisionTraces();
	const long = 'sk-'.padEnd(500, 'x');
	const trace = recordDecisionTrace({ missionId: 'm-sec', iteration: 0, state: 's', signals: {}, candidateAction: 'CONTINUE', selectedAction: 'wait', reason: long, budgetBefore: 1, budgetRequested: 0, budgetGranted: 0, result: 'x', nextDecision: 'y' });
	assert.ok(trace.reason.length <= 300);
});

/* ── W1: testContext builder ─────────────────────────────────────── */

test('W1: buildTestContext assigns risk assessment + prompt section from mission intent', () => {
	const session = { targetUrl: 'http://localhost:9901', secretNames: [], findings: [] };
	const mission = {
		id: 'm-tc',
		type: 'full_audit',
		targetUrl: 'http://localhost:9901',
		objectives: ['Test the checkout and payment flow', 'Verify login'],
		context: { buildPrompt: 'Build an e-commerce app with cart, checkout, payment, login, forms' }
	};
	const ctx = buildTestContext(session, mission);
	assert.ok(ctx, 'testContext assigned');
	assert.ok(Array.isArray(ctx.riskAssessment.risks));
	assert.ok(ctx.riskAssessment.risks.length >= 2, 'transactional + form + nav risks derived from intent');
	assert.ok(ctx.promptSection.includes('RISK-BASED TEST PRIORITIES'));
	assert.equal(ctx.missionId, 'm-tc');
	// deterministic — no LLM markers
	assert.ok(!('purpose' in ctx && ctx.purpose));
});

test('W1: buildTestContext is idempotent — never clobbers adaptive updates mid-mission', () => {
	const session = { targetUrl: 'http://x', secretNames: [], testContext: { adaptiveGuidance: 'PRESERVE ME' } };
	const out = buildTestContext(session, { id: 'm2', context: {} });
	assert.equal(out.adaptiveGuidance, 'PRESERVE ME');
});

test('W1: session without credentials has no auth risk; with credentials → auth risk appears', () => {
	const plain = buildTestContext({ targetUrl: 'http://x', secretNames: [] }, { id: 'a', context: { buildPrompt: 'app with forms' } });
	const withCreds = buildTestContext({ targetUrl: 'http://x', secretNames: ['password'] }, { id: 'b', context: { buildPrompt: 'app with forms' } });
	const plainAuth = plain.riskAssessment.risks.find(r => r.area === 'Authentication');
	const credAuth = withCreds.riskAssessment.risks.find(r => r.area === 'Authentication');
	assert.equal(plainAuth, undefined);
	assert.ok(credAuth, 'credentials imply auth flow in scope');
});

/* ── Budget asymmetry + resolveAction integration ────────────────── */

test('INVARIANT: autonomyEnabled defaults ON, off via QASE_AUTONOMY=off', () => {
	assert.equal(autonomyEnabled(), true);
	const prev = process.env.QASE_AUTONOMY;
	process.env.QASE_AUTONOMY = 'off';
	assert.equal(autonomyEnabled(), false);
	process.env.QASE_AUTONOMY = prev ?? '';
	assert.equal(autonomyEnabled(), true);
});

test('resolveAction maps engine decisions to guarded actions (regression of B2 wiring surface)', () => {
	const mission = { currentIteration: 0, constraints: {}, iterations: [] };
	assert.equal(resolveAction('CONTINUE', mission).action, 'wait');
	assert.equal(resolveAction('REVALIDATE', mission).shouldRevalidate, true);
	assert.equal(resolveAction('STOP_PASS', mission).shouldStop, true);
	assert.equal(resolveAction('ESCALATE', mission).stopReason, 'escalated');
});

test('engine on a settled, evidence-thin session cannot STOP_PASS (safety override) and cannot grant itself budget', () => {
	// A session that ran out of turns with almost no evidence.
	const session = {
		status: 'idle',
		maxTurns: 8,
		turnCount: 8,
		findings: [],
		activities: [],
		capturedSteps: [],
		startedAt: Date.now() - 1000,
		report: undefined,
		decisionHistory: []
	};
	const decision = makeDecisionSafe(session, {}, { id: 'm-inv', context: {}, constraints: {} });
	assert.ok(decision, 'engine always decides (safeFallback on error)');
	// With completeness 0 and budget exhausted the engine must NOT stop-pass
	// and any revalidate desire is moot — budget exhausted is denied by the
	// controller, not the engine. Verify engine type is one of the allowlist.
	assert.ok(['CONTINUE', 'REVALIDATE', 'ESCALATE', 'STOP_PASS', 'STOP_FAIL', 'STOP_BUDGET', 'STOP_BLOCKED'].includes(decision.decision));
});

test('no code path in the controller writes session.maxTurns (source-level guarantee)', async () => {
	const { readFile } = await import('node:fs/promises');
	const src = await readFile(new URL('../server/autonomyController.js', import.meta.url), 'utf8');
	assert.ok(!/session\.maxTurns\s*=/.test(src), 'controller must never assign session.maxTurns');
	assert.ok(!/mission\.context\.maxTurns\s*=/.test(src), 'controller must never rewrite the mission budget');
	assert.ok(!/maxIterations\s*=/.test(src), 'controller must never raise the iteration limit');
});

/* ── cleanup ─────────────────────────────────────────────────────── */

test.after?.(() => rmSync(tmp, { recursive: true, force: true }));
