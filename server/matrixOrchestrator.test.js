/**
 * Matrix orchestrator tests (#14633 NI02 Phase 1).
 *
 * Covers: honest outcome mapping (pass/fail/blocked/error), DuckDuckGo items
 * never launch, sessions carry the matrixRunId link, awaiting_input → BLOCKED
 * (never PASSED), runtime-unavailable → BLOCKED, sequential execution, done
 * status with counts, and the resume scan (dangling RUNNING → ERROR).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMatrixOrchestrator, statusCounts } from './matrixOrchestrator.js';
import { generateEnvironments } from './environmentCatalog.js';
// RT1 (#14680): browser support resolution probes real binaries on a cold
// cache (~0.5s). Prime the version-only registry once so item tests — which
// assert within 100–200ms — measure orchestration, not probe latency.
import { probeLocalBrowsers } from './localBrowserRegistry.js';
await probeLocalBrowsers({ force: true });

function item(overrides = {}) {
	return {
		id: `item-${overrides.browserCode ?? 'chrome'}`,
		ordinal: 0,
		testCaseId: 'TC-1',
		environmentId: 'ENV-IOS-IP17PRO-26.0-CHR-140',
		profileId: 'iphone17pro-ios26-chrome140',
		platform: 'ios',
		device: 'iPhone 17 Pro',
		os: 'iOS',
		osVersion: '26.0',
		browser: 'Chrome',
		browserCode: 'chrome',
		browserVersion: '140',
		deviceType: 'mobile',
		status: 'PENDING',
		reason: null,
		browserSupport: null,
		sessionId: null,
		verdict: null,
		error: null,
		findings: [],
		startedAt: null,
		finishedAt: null,
		durationMs: null,
		...overrides
	};
}

function matrixFixture({ items }) {
	const stored = {
		id: 'matrix-test',
		title: 'Matrix — Login flow',
		targetUrl: 'https://example.com',
		status: 'pending',
		items: items.map((entry, index) => item({
			// Ensure unique ids — updateItem patches by id and would otherwise
			// collide when several default items share "item-chrome".
			id: entry.id ?? `item-${index}-${entry.browserCode ?? 'chrome'}`,
			...entry,
			ordinal: index
		}))
	};
	const patches = [];
	const service = {
		async get() { return structuredClone({ ...stored, items: stored.items.map((it) => ({ ...it })) }); },
		async list() { return [structuredClone(stored)]; },
		async _setStatus(id, status, timing) {
			stored.status = status;
			stored.finishedAt = timing?.finishedAt ?? stored.finishedAt;
			patches.push({ kind: 'status', id, status });
		},
		async updateItem(runId, itemId, patch) {
			assert.equal(runId, stored.id);
			const target = stored.items.find((candidate) => candidate.id === itemId);
			assert.ok(target, `unknown item ${itemId}`);
			Object.assign(target, patch);
			patches.push({ kind: 'item', itemId, patch: { ...patch } });
		}
	};
	return { service, patches, stored };
}

/** Session store fixture: sessions complete with the given outcome. */
function runsFixture(outcomes) {
	const sessions = new Map();
	let created = 0;
	return {
		async create(title, options = {}) {
			created += 1;
			const session = { id: `session-${created}`, title, status: 'idle', ...options };
			sessions.set(session.id, session);
			return session;
		},
		async get(id) { return sessions.get(id); },
		/** Test helper: finish a session with an outcome. */
		finish(id, outcome) {
			const session = sessions.get(id);
			if (session) Object.assign(session, outcome);
		},
		sessionCount: () => sessions.size,
		sessionsRef: sessions
	};
}

function hooksFor(runs, stored, launchBehavior = {}) {
	const launched = [];
	return {
		launched,
		startSession: launchBehavior.startSession ?? (async (matrixRun, item) => {
			const session = await runs.create(`${matrixRun.title} — ${item.device}`, {
				matrixRunId: matrixRun.id,
				environmentId: item.environmentId
			});
			launched.push({ itemId: item.id, sessionId: session.id, options: { matrixRunId: matrixRun.id } });
			if (launchBehavior.launchError) throw launchBehavior.launchError;
			return session;
		}),
		sendTask: async () => {
			if (launchBehavior.taskError) throw launchBehavior.taskError;
		},
		emit: () => {}
	};
}

test('PENDING item executes; verdict pass → PASSED with findings + duration', async () => {
	const runs = runsFixture();
	const { service } = matrixFixture({ items: [{}] });
	const hooks = hooksFor(runs, null);
	// #14650: fixture verification hooks — the engine probes known-defect
	// fixtures per profile and records the actual verdict with expectation.
	hooks.resolveEnvironment = async (item) => ({ envId: item.environmentId, deviceType: 'mobile' });
	hooks.verifyFixtures = [{ id: 'login-button-overlaps-keyboard', affects: (env) => env?.deviceType === 'mobile' || env?.deviceType === 'tablet' }];
	hooks.runFixtureVerification = async ({ fixture, environment }) => ({
		reproduced: environment.deviceType === 'mobile' ? 'TRUE' : 'FALSE',
		evidence: { probe: 'ok' },
		error: null
	});
	// Finish the session the moment it is started.
	const realStart = hooks.startSession;
	hooks.startSession = async (run, item) => {
		const session = await realStart(run, item);
		runs.finish(session.id, {
			status: 'done',
			report: { verdict: 'pass' },
			runtimeFacts: { userAgent: 'Mozilla/5.0 (iPhone)', viewport: { width: 402, height: 874 }, executionLevel: 'SIMULATED', provider: 'local' },
			findings: [{ title: 'Slow login', severity: 'medium', category: 'performance' }]
		});
		return session;
	};
	const orchestrator = createMatrixOrchestrator({ runs, matrix: service }, hooks);
	assert.equal(orchestrator.start('matrix-test').ok, true);
	await new Promise((resolve) => setTimeout(resolve, 50));
	const finalItem = service.get && (await service.get()).items[0];
	assert.equal(finalItem.status, 'PASSED');
	assert.equal(finalItem.sessionId, 'session-1');
	assert.ok(finalItem.durationMs !== null);
	assert.equal(finalItem.findings.length, 1);
	assert.equal(finalItem.findings[0].title, 'Slow login');
	// #14650: fixture verdicts recorded from actual execution, with the
	// expectation stated alongside; runtime facts persisted per profile.
	assert.equal(finalItem.fixtureVerdicts.length, 1);
	assert.equal(finalItem.fixtureVerdicts[0].fixtureId, 'login-button-overlaps-keyboard');
	assert.equal(finalItem.fixtureVerdicts[0].reproduced, 'TRUE');
	assert.equal(finalItem.fixtureVerdicts[0].expected, 'EXPECTED');
	assert.ok(finalItem.fixtureVerdicts[0].evidence);
	assert.equal(finalItem.runtimeFacts.viewport.width, 402);
	assert.equal(finalItem.runtimeFacts.executionLevel, 'SIMULATED');
	assert.equal(finalItem.executionLevel, 'SIMULATED');
	// Session link persisted through the runs.create options.
	assert.equal(runs.sessionsRef.get('session-1').matrixRunId, 'matrix-test');
});

test('verdict fail → FAILED; verdict blocked → BLOCKED; session error → ERROR', async () => {
	const outcomes = [
		{ report: { verdict: 'fail' }, status: 'done' },
		{ report: { verdict: 'blocked' }, status: 'done' },
		{ status: 'error', detail: 'browser crashed' }
	];
	const runs = runsFixture();
	const { service } = matrixFixture({ items: [{}, {}, {}] });
	let index = 0;
	const hooks = hooksFor(runs, null);
	const realStart = hooks.startSession;
	hooks.startSession = async (run, item) => {
		const session = await realStart(run, item);
		runs.finish(session.id, outcomes[index++]);
		return session;
	};
	const orchestrator = createMatrixOrchestrator({ runs, matrix: service }, hooks);
	orchestrator.start('matrix-test');
	await new Promise((resolve) => setTimeout(resolve, 80));
	const items = (await service.get()).items;
	assert.equal(items[0].status, 'FAILED');
	assert.equal(items[1].status, 'BLOCKED');
	assert.equal(items[2].status, 'ERROR');
	assert.match(items[2].error, /browser crashed/);
});

test('awaiting_input → BLOCKED — never PASSED', async () => {
	const runs = runsFixture();
	const { service } = matrixFixture({ items: [{}] });
	const hooks = hooksFor(runs, null);
	const realStart = hooks.startSession;
	hooks.startSession = async (run, item) => {
		const session = await realStart(run, item);
		runs.finish(session.id, { status: 'awaiting_input', pendingQuestion: { text: 'Proceed?' } });
		return session;
	};
	const orchestrator = createMatrixOrchestrator({ runs, matrix: service }, hooks);
	orchestrator.start('matrix-test');
	await new Promise((resolve) => setTimeout(resolve, 50));
	const finalItem = (await service.get()).items[0];
	assert.equal(finalItem.status, 'BLOCKED');
	assert.match(finalItem.error, /awaiting user input/);
});

test('RUNTIME_UNAVAILABLE at launch → BLOCKED, not ERROR', async () => {
	const runs = runsFixture();
	const { service } = matrixFixture({ items: [{}] });
	const hooks = hooksFor(runs, null, {
		startSession: async () => {
			throw Object.assign(new Error('No runtime configured for REAL_DEVICE execution.'), { code: 'RUNTIME_UNAVAILABLE' });
		}
	});
	const orchestrator = createMatrixOrchestrator({ runs, matrix: service }, hooks);
	orchestrator.start('matrix-test');
	await new Promise((resolve) => setTimeout(resolve, 50));
	const finalItem = (await service.get()).items[0];
	assert.equal(finalItem.status, 'BLOCKED');
	assert.match(finalItem.error, /Blocked:/);
});

test('NOT_SUPPORTED item (duckduckgo) never launches a session', async () => {
	const runs = runsFixture();
	const ddg = { id: 'item-duckduckgo', browserCode: 'duckduckgo', browser: 'DuckDuckGo', browserSupport: { status: 'not_supported', reason: 'mobile-only browser with no Playwright build' } };
	const { service } = matrixFixture({ items: [ddg, {}] });
	const hooks = hooksFor(runs, null);
	const realStart = hooks.startSession;
	hooks.startSession = async (run, item) => {
		const session = await realStart(run, item);
		runs.finish(session.id, { status: 'done', report: { verdict: 'pass' } });
		return session;
	};
	const orchestrator = createMatrixOrchestrator({ runs, matrix: service }, hooks);
	orchestrator.start('matrix-test');
	await new Promise((resolve) => setTimeout(resolve, 60));
	const items = (await service.get()).items;
	assert.equal(items[0].status, 'NOT_SUPPORTED');
	assert.equal(items[0].sessionId, null);
	assert.equal(runs.sessionCount(), 1, 'duckduckgo must not have launched a session');
	assert.equal(items[1].status, 'PASSED');
});

test('NOT_RUN / non-PENDING items keep their honest state and never launch', async () => {
	const runs = runsFixture();
	const { service } = matrixFixture({
		items: [
			{ id: 'item-skipped', status: 'NOT_RUN', reason: 'Deselected by user.' },
			{ id: 'item-unsupported', status: 'NOT_SUPPORTED', reason: 'nope' }
		]
	});
	const hooks = hooksFor(runs, null);
	const orchestrator = createMatrixOrchestrator({ runs, matrix: service }, hooks);
	orchestrator.start('matrix-test');
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.equal(runs.sessionCount(), 0);
	const items = (await service.get()).items;
	assert.equal(items[0].status, 'NOT_RUN');
	assert.equal(items[1].status, 'NOT_SUPPORTED');
});

test('double start is refused; run reaches done with counts', async () => {
	const runs = runsFixture();
	const { service } = matrixFixture({ items: [{}] });
	const hooks = hooksFor(runs, null);
	const realStart = hooks.startSession;
	hooks.startSession = async (run, item) => {
		const session = await realStart(run, item);
		await new Promise((resolve) => setTimeout(resolve, 60));
		runs.finish(session.id, { status: 'done', report: { verdict: 'pass' } });
		return session;
	};
	const orchestrator = createMatrixOrchestrator({ runs, matrix: service }, hooks);
	const first = orchestrator.start('matrix-test');
	assert.equal(first.ok, true);
	// While running, a second start is refused.
	const second = orchestrator.start('matrix-test');
	assert.equal(second.ok, false);
	await new Promise((resolve) => setTimeout(resolve, 200));
	assert.equal(orchestrator.isActive('matrix-test'), false);
	assert.equal((await service.get()).status, 'done');
});

test('resume recovery: dangling running run + RUNNING items become ERROR interrupted', async () => {
	const runs = runsFixture();
	const { service, stored } = matrixFixture({
		items: [
			{ id: 'item-running', status: 'RUNNING', sessionId: 'session-gone' },
			{ id: 'item-done', status: 'PASSED', sessionId: 'session-old', verdict: 'pass' }
		]
	});
	stored.status = 'running';
	const orchestrator = createMatrixOrchestrator({ runs, matrix: service }, hooksFor(runs, null));
	await orchestrator.resumeRecovery();
	const run = await service.get();
	assert.equal(run.status, 'error');
	const running = run.items.find((candidate) => candidate.id === 'item-running');
	assert.equal(running.status, 'ERROR');
	assert.match(running.error, /Interrupted/);
	const passed = run.items.find((candidate) => candidate.id === 'item-done');
	assert.equal(passed.status, 'PASSED', 'finished items must be untouched');
});

test('statusCounts tallies the full honest vocabulary', () => {
	const counts = statusCounts([
		{ status: 'PASSED' }, { status: 'PASSED' }, { status: 'FAILED' },
		{ status: 'NOT_RUN' }, { status: 'NOT_SUPPORTED' }, { status: 'BLOCKED' }
	]);
	assert.equal(counts.PASSED, 2);
	assert.equal(counts.FAILED, 1);
	assert.equal(counts.NOT_RUN, 1);
	assert.equal(counts.NOT_SUPPORTED, 1);
	assert.equal(counts.BLOCKED, 1);
	assert.equal(counts.PENDING, 0);
	assert.deepEqual(Object.keys(counts).sort(), [
		'BLOCKED', 'ERROR', 'FAILED', 'NOT_RUN', 'NOT_SUPPORTED', 'PASSED', 'PENDING', 'RUNNING', 'UNAVAILABLE'
	]);
});

// The catalog the items reference must exist so a smoke expansion is coherent.
test('referenced environments exist in the generated catalog (smoke)', () => {
	const all = generateEnvironments();
	const envIds = new Set(all.map((env) => env.envId));
	assert.ok(envIds.has('ENV-IOS-IP17PRO-26.0-CHR-140'), 'iPhone 17 Pro Chrome env missing');
});
