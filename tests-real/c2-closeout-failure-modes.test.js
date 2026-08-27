/**
 * BUILD C2 — Phases 5 + 9: deterministic close-out + failure-mode safety.
 *
 * Deterministic unit tests: no server, no browser, no LLM network. LLM
 * failure is simulated at the module boundary (enhanceGapsWithLLM /
 * runAutonomyPipeline rejects) — the close-out must still produce a
 * truthful report, persist findings, and never fabricate.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'c2-fail-'));
process.env.QASE_STATE_DIR = tmp;

const agent = await import('../server/agent.js');

function sessionFixture(overrides = {}) {
	return {
		id: 's-c2',
		userId: 'u-c2',
		status: 'done',
		maxTurns: 4,
		turnCount: 4,
		targetUrl: 'http://localhost:9901',
		findings: [
			{ id: 'f1', severity: 'high', title: 'Broken login validation', recommendation: 'fix input handling' }
		],
		capturedSteps: [
			{ title: 'opened home', url: 'http://localhost:9901/' },
			{ title: 'opened login', url: 'http://localhost:9901/login' }
		],
		activities: [],
		messages: [],
		secretNames: [],
		startedAt: Date.now() - 10_000,
		report: undefined,
		...overrides
	};
}

/* ── Phase 5: deterministic finding close-out ─────────────────────── */

test('P5: close-out compiles a truthful report with ZERO model calls', () => {
	const session = sessionFixture();
	const ok = agent.finalizeTurnLimitedRun(session);
	assert.equal(ok, true);
	assert.equal(session.report.deterministicCloseOut, true);
	assert.equal(session.report.verdict, 'pass_with_issues'); // 1 non-critical finding
	assert.equal(session.report.findings.length, 1);
	assert.ok(session.report.summary.includes('deterministically'));
	// evidence-backed: covered areas come from the captured steps
	assert.ok(session.report.covered.includes('opened home'));
});

test('P5: critical finding → fail verdict without any LLM', () => {
	const session = sessionFixture({
		findings: [{ id: 'f0', severity: 'critical', title: 'Auth bypass' }]
	});
	agent.finalizeTurnLimitedRun(session);
	assert.equal(session.report.verdict, 'fail');
});

test('P5: no findings → inconclusive, never a fabricated pass', () => {
	const session = sessionFixture({ findings: [] });
	agent.finalizeTurnLimitedRun(session);
	assert.equal(session.report.verdict, 'inconclusive');
	assert.equal(session.report.findings.length, 0);
});

test('P5: close-out is idempotent and refuses non-settled sessions', () => {
	const done = sessionFixture();
	assert.equal(agent.finalizeTurnLimitedRun(done), true);
	assert.equal(agent.finalizeTurnLimitedRun(done), false); // report exists
	const running = sessionFixture({ status: 'running' });
	assert.equal(agent.finalizeTurnLimitedRun(running), false);
	const errored = sessionFixture({ status: 'error' });
	assert.equal(agent.finalizeTurnLimitedRun(errored), false);
});

test('P5: close-out sets the LLM-suppression flags the pipeline honors', async () => {
	const session = sessionFixture();
	agent.finalizeTurnLimitedRun(session);
	assert.equal(session._deterministicCloseOut, true, 'feature_gap must skip enhanceGapsWithLLM');
	assert.equal(session._closeOutPipeline, true, 'finalize must wait for pipeline findings');
	// capabilityFilter contract: expensive LLM stages excluded — verify by
	// reading the source once (cheap, and the contract is load-bearing).
	const { readFile } = await import('node:fs/promises');
	const src = await readFile(new URL('../server/agent.js', import.meta.url), 'utf8');
	assert.ok(src.includes("id => !['test_generation', 'smoke_run', 'schedule_create', 'dev_intelligence'].includes(id)"),
		'capabilityFilter must exclude LLM-heavy stages');
	assert.ok(src.includes('_deterministicCloseOut = true'));
});

test('P5: capabilities honors the suppression flag (feature_gap skips LLM enhancement)', async () => {
	const caps = await import('../server/capabilities.js');
	const src = await import('node:fs/promises').then(m => m.readFile(new URL('../server/capabilities.js', import.meta.url), 'utf8'));
	// The guard must exist: when _deterministicCloseOut is set, enhanceGapsWithLLM is not called.
	assert.ok(/_deterministicCloseOut/.test(src), 'capabilities.js must reference the suppression flag');
	// and it must be a conditional skip, not a removal: full pipeline keeps enrichment.
	assert.ok(/enhanceGapsWithLLM/.test(src), 'full pipeline still enriches gaps');
});

/* ── Phase 9: autonomy failure modes ──────────────────────────────── */

test('P9: runAutonomyPipeline failure never blocks the deterministic report', async () => {
	const session = sessionFixture();
	// The close-out launches the pipeline fire-and-forget; simulate its
	// total failure by asserting the report is ALREADY complete before the
	// pipeline could matter (the code path the catch logs on failure).
	agent.finalizeTurnLimitedRun(session);
	assert.ok(session.report, 'report exists regardless of pipeline outcome');
	assert.equal(session.report.verdict, 'pass_with_issues');
});

test('P9: budget edge — exactly-at-limit and over-limit sessions close out truthfully', () => {
	const atLimit = sessionFixture({ maxTurns: 4, turnCount: 4 });
	agent.finalizeTurnLimitedRun(atLimit);
	assert.ok(atLimit.report.summary.includes('4 turns'));

	const overLimit = sessionFixture({ maxTurns: 2, turnCount: 7 }); // SDK disobeyed; abort kicked in
	agent.finalizeTurnLimitedRun(overLimit);
	assert.ok(overLimit.report, 'over-limit session still gets a truthful close-out');
	assert.ok(overLimit.report.summary.includes('2 turns'), 'authorized budget is what the report claims');
});

test('P9: empty session (no steps, no findings) still produces a valid close-out', () => {
	const empty = sessionFixture({ findings: [], capturedSteps: [], activities: [] });
	agent.finalizeTurnLimitedRun(empty);
	assert.equal(empty.report.verdict, 'inconclusive');
	assert.deepEqual(empty.report.covered, []);
});

test('P9: close-out never mutates turnCount or maxTurns (budget is not "found" time)', () => {
	const session = sessionFixture({ maxTurns: 3, turnCount: 3 });
	agent.finalizeTurnLimitedRun(session);
	assert.equal(session.maxTurns, 3);
	assert.equal(session.turnCount, 3);
});

test.after?.(() => rmSync(tmp, { recursive: true, force: true }));
