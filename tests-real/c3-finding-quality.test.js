/**
 * BUILD C3 — Phase 2 (target quality) + Phase 3 (confidence quality)
 * + Phase 4 (mission linkage) contract tests.
 *
 * Deterministic unit/contract tests — no live server, no LLM.
 * Covers the C3 spec acceptance criteria A/B/C.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SCRATCH = join(ROOT, '.qase-test-scratch', `c3-${process.pid}`);

before(() => {
	rmSync(SCRATCH, { recursive: true, force: true });
	mkdirSync(SCRATCH, { recursive: true });
});

/* ─────────────────────────────────────────────────────────────────────────
 * P2 — Target-type / input-quality gate
 * ──────────────────────────────────────────────────────────────────────── */

const featureGap = await import(`${ROOT}/server/featureGap.js`);
const { generateExpectedFeatures, analyzeFeatureGaps, inferAppPurpose, extractAppInventory } = featureGap;

/** Build a REAL inventory via extractAppInventory so shape matches production. */
const invFor = (sessionLike) => extractAppInventory(sessionLike);

const crmSession = {
	id: 's-crm', targetUrl: 'https://app.example.com',
	capturedSteps: [
		{ action: 'goto', url: 'https://app.example.com/contacts', outcome: {} },
		{ action: 'goto', url: 'https://app.example.com/deals', outcome: {} },
		{ action: 'goto', url: 'https://app.example.com/pipeline', outcome: {} },
		{ action: 'click', target: 'contact', outcome: {} },
		{ action: 'click', target: 'deal', outcome: {} },
		{ action: 'fill', target: 'opportunity', outcome: {} },
		{ action: 'fill', target: 'lead', outcome: {} },
		{ action: 'click', target: 'prospect', outcome: {} },
		{ action: 'goto', url: 'https://app.example.com/sales-funnel', outcome: {} },
		{ action: 'goto', url: 'https://app.example.com/customer', outcome: {} },
		{ action: 'click', target: 'crm', outcome: {} }
	],
	activities: [
		{ detail: 'view contacts list' }, { detail: 'update deal stage in pipeline' },
		{ detail: 'manage lead and prospect records' }, { detail: 'log customer call' }
	],
	todos: [{ text: 'test opportunity creation' }],
	findings: [], messages: [],
	report: { summary: 'CRM platform with leads, pipeline, deals, contacts and opportunities for the sales team' },
	pages: []
};

const marketingSession = {
	id: 's-mkt', targetUrl: 'https://new.example.com',
	capturedSteps: [
		{ action: 'goto', url: 'https://new.example.com/', outcome: {} },
		{ action: 'goto', url: 'https://new.example.com/pricing', outcome: {} }
	],
	activities: [{ detail: 'read homepage content' }],
	todos: [], findings: [], messages: [],
	report: { summary: 'Marketing site — product pages and pricing' },
	pages: []
};

describe('C3-P2: purpose-catalog gating on classification confidence', () => {

	test('confident classification still produces catalog expected features', () => {
		// A genuinely CRM-looking inventory at full exploration depth.
		const inv = invFor(crmSession);
		const purpose = inferAppPurpose(inv, crmSession);
		assert.ok(purpose.confidence >= 0.5, `purpose.confidence ${purpose.confidence} should be >= 0.5 for a strong CRM signal`);
		const out = generateExpectedFeatures(inv, purpose, crmSession);
		assert.ok(out.expected.length > 0, 'catalog features still generated for confident classification');
		assert.equal(out.gated, false);
	});

	test('uncertain classification suppresses catalog expected features (structured, auditable)', () => {
		// Weak signal + shallow exploration → purpose confidence far below floor.
		const inv = invFor(marketingSession);
		assert.ok(inv.explorationConfidence <= 0.4, `shallow exploration expected, got ${inv.explorationConfidence}`);
		const purpose = inferAppPurpose(inv, marketingSession);
		const out = generateExpectedFeatures(inv, purpose, marketingSession);
		assert.equal(out.gated, true, 'gate engages for low purpose.confidence');
		const purposeSourced = out.expected.filter(e => !['authentication', 'forms', 'untested', 'user_management'].includes(e.category));
		assert.equal(purposeSourced.length, 0, 'no catalog features from uncertain classification');
		assert.ok(typeof out.excludedByUncertainty === 'number' && out.excludedByUncertainty >= 0,
			'excluded count recorded in structured data');
		assert.ok(typeof out.purposeConfidence === 'number');
		assert.ok(typeof out.explorationConfidence === 'number');
	});

	test('gating metadata flows into the gap analysis (auditable)', () => {
		const session = {
			id: 'sess-c3-gate', projectId: 'p1', missionId: 'm1', targetUrl: 'https://x.example.com',
			capturedSteps: [{ action: 'goto', url: 'https://x.example.com/', outcome: {} }],
			activities: [], todos: [], findings: [], messages: [], status: 'done',
			report: { summary: 'A homepage with a contact email link' }, pages: [], steps: 3, testContext: {}
		};
		const analysis = analyzeFeatureGaps(session, {});
		assert.ok(analysis.gated === true || analysis.gated === false, 'analysis carries gated flag');
		assert.ok('purposeConfidence' in analysis, 'analysis carries purposeConfidence');
		if (analysis.gated) {
			assert.equal(analysis.gaps.filter(g => g.source === 'purpose').length, 0,
				'gated analysis contains zero purpose-sourced gaps');
		}
	});

	test('genuine non-classification findings are unaffected by the gate', () => {
		// Agent-filed findings are not created by featureGap — the gate must not
		// touch them. Structural assertion: analyzeFeatureGaps output gaps (if
		// any) never include agent-reported categories.
		const session = {
			id: 'sess-c3-genuine', projectId: 'p1', missionId: 'm1', targetUrl: 'https://x.example.com',
			capturedSteps: [{ action: 'goto', url: 'https://x.example.com/', outcome: {} }],
			findings: [{ id: 'f1', title: 'Console error on load', severity: 'high', category: 'console_error', confidence: 0.9 }],
			messages: [], activities: [], todos: [], status: 'done',
			report: { summary: 'page' }, pages: [], steps: 2, testContext: {}
		};
		const analysis = analyzeFeatureGaps(session, {});
		// Existing findings are never filtered out by C3.
		assert.equal(session.findings.length, 1);
		const gapCats = (analysis.gaps ?? []).map(g => g.category);
		assert.ok(!gapCats.includes('console_error'), 'gate never invents/removes agent categories');
	});
});

/* ────────────────────────────────────────────────────────────────────────
 * P3 — Confidence-quality policy (decision engine)
 * ──────────────────────────────────────────────────────────────────────── */

const { collectDecisionInput, makeDecisionSafe, DECISION_TYPES } = await import(`${ROOT}/server/decisionEngine.js`);

const baseSession = (findings, over = {}) => ({
	id: 's', projectId: 'p', missionId: 'm',
	findings, messages: [], activities: [], todos: [],
	status: 'done', maxTurns: 8, turnCount: 8,
	summary: 'ok', pages: [], steps: 30, testContext: {},
	...over
});

describe('C3-P3: decision-grade evidence policy', () => {

	test('high-confidence critical → decision-grade → STOP_FAIL preserved', () => {
		const s = baseSession([{ id: 'f1', severity: 'critical', confidence: 0.9, isDuplicate: false, evidence: 'x' }]);
		const input = collectDecisionInput(s);
		assert.ok(input.criticalCount >= 1, 'decision-grade critical counted');
		const decision = makeDecisionSafe(s, {});
		assert.equal(decision.decision, DECISION_TYPES.STOP_FAIL, 'confirmed critical still STOP_FAIL');
	});

	test('low-confidence critical alone cannot STOP_FAIL — but is not hidden', () => {
		const s = baseSession([{ id: 'f1', severity: 'critical', confidence: 0.06, isDuplicate: false }]);
		const input = collectDecisionInput(s);
		assert.equal(input.criticalCount, 0, 'low-confidence critical is not decision-grade');
		assert.equal(input.rawCriticalCount, 1, 'raw count still visible as a signal');
		assert.equal(input.lowConfidenceCriticalCount, 1, 'low-confidence critical tracked explicitly');
		const decision = makeDecisionSafe(s, {});
		assert.notEqual(decision.decision, DECISION_TYPES.STOP_FAIL,
			'low-confidence critical must not independently manufacture STOP_FAIL');
	});

	test('null-confidence critical (legacy/agent-filed, unscored) keeps legacy weight', () => {
		const s = baseSession([{ id: 'f1', severity: 'critical', isDuplicate: false }]);
		const input = collectDecisionInput(s);
		assert.ok(input.criticalCount >= 1, 'unscored criticals are not silently downgraded');
	});

	test('low-confidence critical drives INVESTIGATE (bounded verification), not a hidden drop', () => {
		const s = baseSession([
			{ id: 'f1', severity: 'critical', confidence: 0.06, isDuplicate: false },
			{ id: 'f2', severity: 'medium', confidence: 0.5, isDuplicate: false, evidence: 'y', steps: [1] }
		]);
		const decision = makeDecisionSafe(s, {});
		assert.ok([DECISION_TYPES.INVESTIGATE, DECISION_TYPES.CONTINUE, DECISION_TYPES.STOP_BUDGET].includes(decision.decision),
			`expected a bounded decision, got ${decision.decision}`);
	});

	test('duplicate criticals excluded from decision-grade counts', () => {
		const s = baseSession([
			{ id: 'f1', severity: 'critical', confidence: 0.9, isDuplicate: true },
			{ id: 'f2', severity: 'critical', confidence: 0.9, isDuplicate: false }
		]);
		const input = collectDecisionInput(s);
		assert.equal(input.criticalCount, 1);
	});

	test('no findings → no crash, sensible decision', () => {
		const s = baseSession([]);
		const input = collectDecisionInput(s);
		assert.equal(input.criticalCount, 0);
		assert.equal(input.rawCriticalCount, 0);
		const decision = makeDecisionSafe(s, {});
		assert.ok(decision.decision, 'engine always returns a decision');
	});

	test('high-confidence non-critical does not trigger STOP_FAIL by itself', () => {
		const s = baseSession([{ id: 'f1', severity: 'medium', confidence: 0.95, isDuplicate: false }]);
		const decision = makeDecisionSafe(s, {});
		assert.notEqual(decision.decision, DECISION_TYPES.STOP_FAIL);
	});

	test('safety rule 3 (critical blocks pass) uses decision-grade counts only', () => {
		const s = baseSession([{ id: 'f1', severity: 'critical', confidence: 0.06, isDuplicate: false }]);
		const decision = makeDecisionSafe(s, {});
		assert.notEqual(decision.decision, DECISION_TYPES.STOP_FAIL,
			'Safety-Rule-3 must not convert low-confidence critical into STOP_FAIL');
	});
});

/* ────────────────────────────────────────────────────────────────────────
 * P4 — missionId linkage
 *
 * Hermetic: runs in a subprocess with QASE_DATA_DIR pointed at a scratch
 * dir so the LIVE findings store is never touched by these tests.
 * ──────────────────────────────────────────────────────────────────────── */

const { execFileSync } = await import('node:child_process');

const runP4 = (script) => {
	const dir = join(SCRATCH, `p4-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
	mkdirSync(dir, { recursive: true });
	return execFileSync('node', ['--input-type=module', '-e', script], {
		cwd: dir, encoding: 'utf8',
		env: { ...process.env, QASE_DATA_DIR: dir }
	});
};

describe('C3-P4: mission linkage at write time + backfill', () => {

	test('syncSessionFinding stamps missionId from the session', () => {
		const out = runP4(`
import { syncSessionFinding, listFindings } from '${ROOT}/server/findings.js';
syncSessionFinding({ id: 'sess-l1', projectId: 'p-l', missionId: 'm-l' }, { id: 'f-l1', title: 't', severity: 'high', category: 'bug', confidence: 0.8 });
const stored = listFindings({}).find(x => x.id === 'f-l1');
if (stored.missionId !== 'm-l') throw new Error('missionId not stamped: ' + stored.missionId);
console.log('OK');
`);
		assert.match(out, /OK/);
	});

	test('update branch preserves an existing missionId (never clobbered)', () => {
		const out = runP4(`
import { syncSessionFinding, listFindings } from '${ROOT}/server/findings.js';
syncSessionFinding({ id: 'sess-l1', projectId: 'p-l', missionId: 'm-l' }, { id: 'f-l2', title: 't2', severity: 'medium', category: 'bug', missionId: 'm-other' });
let stored = listFindings({}).find(x => x.id === 'f-l2');
if (stored.missionId !== 'm-other') throw new Error('explicit missionId overwritten: ' + stored.missionId);
syncSessionFinding({ id: 'sess-l1', projectId: 'p-l', missionId: 'm-l' }, { id: 'f-l2', title: 't2b', severity: 'medium', category: 'bug' });
stored = listFindings({}).find(x => x.id === 'f-l2');
if (stored.missionId !== 'm-other') throw new Error('existing missionId clobbered: ' + stored.missionId);
console.log('OK');
`);
		assert.match(out, /OK/);
	});

	test('backfill is deterministic and idempotent (via sessionId → mission)', () => {
		const out = runP4(`
import { syncSessionFinding, listFindings, backfillMissionLinkage } from '${ROOT}/server/findings.js';
syncSessionFinding({ id: 'sess-bf', projectId: 'p' }, { id: 'f-bf1', title: 'bf', severity: 'low', category: 'bug' });
const missions = [{ id: 'm-bf', sessionId: 'sess-bf', createdAt: 1 }];
const r1 = backfillMissionLinkage(missions);
if (r1.linked < 1) throw new Error('backfill linked ' + r1.linked);
let stored = listFindings({}).find(x => x.id === 'f-bf1');
if (stored.missionId !== 'm-bf') throw new Error('not linked: ' + stored.missionId);
const r2 = backfillMissionLinkage(missions);
if (r2.linked !== 0) throw new Error('not idempotent: linked ' + r2.linked);
stored = listFindings({}).find(x => x.id === 'f-bf1');
if (stored.missionId !== 'm-bf') throw new Error('linkage lost on second run');
console.log('OK linked=' + r1.linked);
`);
		assert.match(out, /OK linked=/);
	});

	test('unresolvable historical findings are never given a fabricated missionId', () => {
		const out = runP4(`
import { syncSessionFinding, listFindings, backfillMissionLinkage } from '${ROOT}/server/findings.js';
syncSessionFinding({ id: 'sess-unknown', projectId: 'p' }, { id: 'f-hist', title: 'h', severity: 'low', category: 'bug' });
const r = backfillMissionLinkage([{ id: 'm-x', sessionId: 'sess-other', createdAt: 1 }]);
const stored = listFindings({}).find(x => x.id === 'f-hist');
if (stored.missionId !== undefined) throw new Error('fabricated: ' + stored.missionId);
if (r.linked !== 0) throw new Error('linked unresolvable: ' + r.linked);
console.log('OK');
`);
		assert.match(out, /OK/);
	});

	test('cross-mission isolation: missionId filter returns only that mission\'s findings', () => {
		const out = runP4(`
import { syncSessionFinding, listFindings } from '${ROOT}/server/findings.js';
syncSessionFinding({ id: 'sess-A', projectId: 'p', missionId: 'mA' }, { id: 'f-A', title: 'a', severity: 'low', category: 'bug' });
syncSessionFinding({ id: 'sess-B', projectId: 'p', missionId: 'mB' }, { id: 'f-B', title: 'b', severity: 'low', category: 'bug' });
const forA = listFindings({ missionId: 'mA' });
if (!forA.some(f => f.id === 'f-A')) throw new Error('f-A missing');
if (forA.some(f => f.id === 'f-B')) throw new Error('cross-contamination');
console.log('OK n=' + forA.length);
`);
		assert.match(out, /OK n=/);
	});
});
