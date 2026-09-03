/**
 * D2.1 — Configurable session wall-clock timeout.
 *
 * Covers:
 *  1. Default (no env) resolves to 20 minutes — byte-identical legacy behavior.
 *  2. QASE_SESSION_TIMEOUT_MINUTES honored within 5–120.
 *  3. Clamp + warn on out-of-range / garbage values.
 *  4. Truthful attribution: a wall-clock timeout stop produces a close-out
 *     summary that names the timeout, NOT the turn budget; stopCause recorded.
 *  5. Budget-stopped runs keep the exact legacy "turn budget" wording.
 *  6. Test-case generation stays skipped on timeout close-out (invariant).
 *
 * Runs offline against the module — no server required (spawns of index.js
 * are avoided; the resolver is a pure env reader).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* ── Hermeticity (R2-B-H) ──────────────────────────────────────────────
 * This suite dynamically imports server/agent.js, which instantiates a
 * FRESH server/store.js whose STATE_DIR is derived from process.cwd().
 * Run from /workspace, that fresh store's persistSoon() debounce wrote
 * its EMPTY map over the REAL .qase/sessions.json (proven pre-existing
 * at f18049a). The suite therefore runs inside its own temporary cwd so
 * the fresh store can only ever write <tmp>/.qase — and the after()
 * guard below proves the real store is byte-identical afterwards.
 * NOTE: relative specifiers ('../server/agent.js') resolve from this
 * FILE's URL, not cwd, so the imports are unaffected by the chdir. */
const ORIGINAL_CWD = process.cwd();
const REAL_SESSIONS_FILE = join(ORIGINAL_CWD, '.qase', 'sessions.json');
const realSessionsBefore = existsSync(REAL_SESSIONS_FILE) ? readFileSync(REAL_SESSIONS_FILE) : null;
const TEST_CWD = mkdtempSync(join(tmpdir(), 'qase-st-'));
process.chdir(TEST_CWD);

after(async () => {
	// Let any in-flight persistSoon() debounce (250 ms, unref'd) land in the
	// TEMP store so the existence proof below is deterministic.
	await new Promise(resolve => setTimeout(resolve, 600));
	const tempStore = join(TEST_CWD, '.qase', 'sessions.json');
	if (!existsSync(tempStore)) {
		process.chdir(ORIGINAL_CWD);
		rmSync(TEST_CWD, { recursive: true, force: true });
		throw new Error(
			`[hermeticity] expected this suite's store writes to land in ${tempStore} — they went somewhere else`
		);
	}
	const realSessionsAfter = existsSync(REAL_SESSIONS_FILE) ? readFileSync(REAL_SESSIONS_FILE) : null;
	process.chdir(ORIGINAL_CWD);
	rmSync(TEST_CWD, { recursive: true, force: true });
	assert.ok(
		realSessionsBefore === null ? realSessionsAfter === null : realSessionsAfter?.equals(realSessionsBefore),
		'[hermeticity] the real /workspace/.qase/sessions.json changed during this suite'
	);
});

/* ── resolver under a controlled env ───────────────────────────────── */

async function resolveWith(envValue) {
	const prev = process.env.QASE_SESSION_TIMEOUT_MINUTES;
	if (envValue === undefined) delete process.env.QASE_SESSION_TIMEOUT_MINUTES;
	else process.env.QASE_SESSION_TIMEOUT_MINUTES = envValue;
	try {
		// Dynamic import re-evaluates the module fresh in a child registry.
		const mod = await import(`../server/agent.js?env=${encodeURIComponent(String(envValue))}&t=${Date.now()}-${Math.random()}`);
		return mod.__resolveSessionTimeoutMs();
	} finally {
		if (prev === undefined) delete process.env.QASE_SESSION_TIMEOUT_MINUTES;
		else process.env.QASE_SESSION_TIMEOUT_MINUTES = prev;
	}
}

/* ── helper: import finalizeTurnLimitedRun with no env override ────── */

async function agentModule() {
	return import(`../server/agent.js?stable&t=${Date.now()}-${Math.random()}`);
}

test('D2.1-1: default (env unset) → 20 minutes', async () => {
	const ms = await resolveWith(undefined);
	assert.equal(ms, 20 * 60 * 1000);
});

test('D2.1-1b: env empty string → 20 minutes', async () => {
	const ms = await resolveWith('');
	assert.equal(ms, 20 * 60 * 1000);
});

test('D2.1-2: override honored inside 5–120', async () => {
	assert.equal(await resolveWith('45'), 45 * 60 * 1000);
	assert.equal(await resolveWith('5'), 5 * 60 * 1000);
	assert.equal(await resolveWith('120'), 120 * 60 * 1000);
});

test('D2.1-3: below floor clamps to default 20', async () => {
	const ms = await resolveWith('4');
	assert.equal(ms, 20 * 60 * 1000);
});

test('D2.1-3b: above ceiling clamps to 120', async () => {
	const ms = await resolveWith('999');
	assert.equal(ms, 120 * 60 * 1000);
});

test('D2.1-3c: garbage value falls back to 20', async () => {
	const ms = await resolveWith('abc');
	assert.equal(ms, 20 * 60 * 1000);
});

/* ── truthful attribution through finalizeTurnLimitedRun ───────────── */

function makeSession({ stopCause, maxTurns, turnCount } = {}) {
	return {
		id: `d21-test-${Math.random().toString(36).slice(2, 10)}`,
		status: 'done',
		messages: [],
		findings: [],
		capturedSteps: [{ title: 'Home' }, { title: 'Pricing' }],
		maxTurns,
		turnCount,
		stopCause
	};
}

test('D2.1-4: wall-clock stop → summary names the timeout, not the budget', async () => {
	const { finalizeTurnLimitedRun } = await agentModule();
	const session = makeSession({ stopCause: 'wall_clock_timeout', maxTurns: 300, turnCount: 148 });
	assert.ok(finalizeTurnLimitedRun(session), 'close-out runs');
	const summary = session.report.summary;
	assert.match(summary, /wall-clock timeout/i);
	assert.doesNotMatch(summary, /turn budget/i);
	assert.match(summary, /turn 148 of 300/);
	assert.equal(session.stopCause, 'wall_clock_timeout');
});

test('D2.1-5: budget stop keeps the exact legacy wording (B2 regression guard)', async () => {
	const { finalizeTurnLimitedRun } = await agentModule();
	const session = makeSession({ maxTurns: 300, turnCount: 300 });
	assert.ok(finalizeTurnLimitedRun(session));
	const summary = session.report.summary;
	assert.match(summary, /Run stopped at the authorized turn budget \(300 turns\)/);
	assert.doesNotMatch(summary, /wall-clock/i);
});

test('D2.1-4b: timeout close-out leaves verdict honest with zero findings → inconclusive', async () => {
	const { finalizeTurnLimitedRun } = await agentModule();
	const session = makeSession({ stopCause: 'wall_clock_timeout', maxTurns: 100, turnCount: 42 });
	finalizeTurnLimitedRun(session);
	assert.equal(session.report.verdict, 'inconclusive');
});

test('D2.1-4c: timeout close-out recommendation mentions the env knob', async () => {
	const { finalizeTurnLimitedRun } = await agentModule();
	const session = makeSession({ stopCause: 'wall_clock_timeout', maxTurns: 100, turnCount: 42 });
	finalizeTurnLimitedRun(session);
	assert.ok(
		session.report.recommendations.some(r => /QASE_SESSION_TIMEOUT_MINUTES/.test(r)),
		'recommendation tells the operator about the knob'
	);
});

test('D2.1-6: timeout close-out runs the DETERMINISTIC pipeline, never the full one', async () => {
	// finalizeTurnLimitedRun sets _closeOutPipeline=true and passes a
	// capabilityFilter that EXCLUDES test_generation/smoke_run/
	// schedule_create/dev_intelligence — the close-out must settle in
	// seconds, so a timeout stop can never generate test cases. We assert
	// the deterministic markers are stamped (they are what route this run
	// AWAY from the normal completion pipeline) and the report is present.
	const { finalizeTurnLimitedRun } = await agentModule();
	const session = makeSession({ stopCause: 'wall_clock_timeout', maxTurns: 100, turnCount: 42 });
	finalizeTurnLimitedRun(session);
	assert.ok(session.report, 'deterministic report present');
	assert.ok(session.report.deterministicCloseOut === true, 'report marked deterministic');
	assert.ok(session._closeOutPipeline === true, 'close-out pipeline flag set (keeps expensive stages out)');
	assert.ok(session._deterministicCloseOut === true, 'deterministic close-out marker set');
	// and no test-case material was created for this synthetic session
	assert.equal((session.findings ?? []).length, 0);
});

test('D2.1-7: no session fields fabricated — turnCount preserved truthfully', async () => {
	const { finalizeTurnLimitedRun } = await agentModule();
	const session = makeSession({ stopCause: 'wall_clock_timeout', maxTurns: 300, turnCount: 148 });
	finalizeTurnLimitedRun(session);
	assert.equal(session.turnCount, 148, 'true turn count preserved');
	assert.equal(session.maxTurns, 300, 'authorized limit preserved');
});
