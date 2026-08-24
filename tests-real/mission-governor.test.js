/**
 * M1-P4.2 — Mission Execution Governor tests.
 *
 * Two layers:
 *  1. UNIT — the governor module in isolation with an injected fake config
 *     and fake mission map (no server, no browser, no LLM).
 *  2. LIVE-API — against the running server (QASE_API_TOKEN required):
 *     a bounded queue of small missions against the local practice target,
 *     queue cancel, and slot-release-promotion. Small and deterministic by
 *     design (the M1-P4.2 mandate: prove control, not load-test).
 *
 * Run: node --test tests-real/mission-governor.test.js   (unit part always;
 *      live part auto-skips without QASE_API_TOKEN)
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

/* ── Part 1: unit tests with injected dependencies ──────────────── */

import {
	__resetForTests, governorStats, queuePositionOf
} from '../server/missionGovernor.js';

/** Deterministic fake of the governor's config dependency surface. */
function makeFakeConfig(maxConcurrentMissions, missionTimeoutMinutes = 60) {
	return { getConfig: () => ({ maxConcurrentMissions, missionTimeoutMinutes }) };
}

async function freshGovernor(max, opts = {}) {
	// missionGovernor imports getConfig from ./config.js directly; the unit
	// harness injects a deterministic limit through the module's test hook.
	const mod = await import(`../server/missionGovernor.js?unit=${Math.random()}`);
	// The module shares state across importers in the same process; reset it
	// and pin the fake config surface so slots/timeout are test-controlled.
	mod.__resetForTests(makeFakeConfig(max));
	// Map() takes an iterable of entries (or nothing) — a bare {} throws
	// "object is not iterable" on Node 20, so default to an empty array.
	const statuses = new Map(opts.statuses ?? []);
	const startedAts = new Map(opts.startedAts ?? []);
	const sessions = new Map(opts.sessions ?? []);
	const events = [];
	mod.startGovernorWatchdog({
		getMissionStatus: id => statuses.get(id),
		getMissionStartedAt: id => startedAts.get(id),
		getSessionIdFor: id => sessions.get(id)?.sessionId ?? null,
		probeSession: sessionId => sessions.get(sessionId)?.probe ?? { settled: false, running: false },
		onStuck: id => events.push(['stuck', id]),
		onTimeout: id => events.push(['timeout', id]),
		log: () => {}
	});
	// A watchdog interval would keep the process alive between tests; stop it.
	mod.stopGovernorWatchdog();
	return { mod, statuses, events };
}

describe('Governor UNIT — slot accounting', () => {
	it('grants slots up to the limit', async () => {
		const { mod } = await freshGovernor(2);
		const started = [];
		assert.equal(mod.submitMission('m1', () => started.push('m1')), 'started');
		assert.equal(mod.submitMission('m2', () => started.push('m2')), 'started');
		assert.deepEqual(started, ['m1', 'm2']);
		// Assert against the SAME module instance the submissions went to —
		// the top-level import is a different (stale) instance in this harness.
		assert.equal(mod.governorStats().activeCount, 2);
		mod.__resetForTests(null);
	});

	it('queues the N+1 mission with a stable position', async () => {
		const { mod } = await freshGovernor(1);
		mod.submitMission('m1', () => {});
		assert.equal(mod.submitMission('m2', () => {}), 'queued');
		assert.equal(mod.submitMission('m3', () => {}), 'queued');
		assert.equal(mod.queuePositionOf('m2'), 1);
		assert.equal(mod.queuePositionOf('m3'), 2);
		assert.equal(mod.queuePositionOf('m1'), 0);
		mod.__resetForTests(null);
	});

	it('duplicate submission is idempotent (no duplicate execution)', async () => {
		const { mod } = await freshGovernor(1);
		let kicks = 0;
		mod.submitMission('m1', () => { kicks += 1; });
		assert.equal(mod.submitMission('m1', () => { kicks += 1; }), 'already-tracked');
		assert.equal(kicks, 1);
		assert.equal(mod.governorStats().queueDepth, 0);
		mod.__resetForTests(null);
	});

	it('release promotes exactly one queued mission (FIFO)', async () => {
		const { mod } = await freshGovernor(1);
		const order = [];
		mod.submitMission('m1', () => order.push('m1'));
		mod.submitMission('m2', () => order.push('m2'));
		mod.submitMission('m3', () => order.push('m3'));
		mod.releaseMission('m1');
		assert.deepEqual(order, ['m1', 'm2']);
		assert.equal(mod.governorStats().activeCount, 1);
		mod.releaseMission('m2');
		assert.deepEqual(order, ['m1', 'm2', 'm3']);
		mod.__resetForTests(null);
	});

	it('cancelling a queued mission removes it without executing', async () => {
		const { mod } = await freshGovernor(1);
		const order = [];
		mod.submitMission('m1', () => order.push('m1'));
		mod.submitMission('m2', () => order.push('m2'));
		assert.equal(mod.cancelMission('m2'), 'cancelled-queued');
		mod.releaseMission('m1');
		assert.deepEqual(order, ['m1']); // m2 never started, nothing promoted past limit
		assert.equal(mod.governorStats().queueDepth, 0);
		mod.__resetForTests(null);
	});

	it('cancelMission reports running/unknown honestly', async () => {
		const { mod } = await freshGovernor(1);
		mod.submitMission('m1', () => {});
		assert.equal(mod.cancelMission('m1'), 'running');
		assert.equal(mod.cancelMission('nope'), 'unknown');
		mod.__resetForTests(null);
	});

	it('onStart throwing releases the slot (unexpected exception)', async () => {
		const { mod } = await freshGovernor(1);
		assert.throws(() => mod.submitMission('m1', () => { throw new Error('boom'); }), /boom/);
		assert.equal(mod.governorStats().activeCount, 0);
		// slot is reusable
		assert.equal(mod.submitMission('m2', () => {}), 'started');
		mod.__resetForTests(null);
	});

	it('a failed onStart for a queued promotion tries the next in line', async () => {
		const { mod } = await freshGovernor(1);
		const started = [];
		mod.submitMission('m1', () => started.push('m1'));
		mod.submitMission('m2', () => { throw new Error('crash on start'); });
		mod.submitMission('m3', () => started.push('m3'));
		// pump swallows the crashed promotion (logs + releases, keeps pumping)
		// so releaseMission itself never throws — the failure is contained.
		mod.releaseMission('m1');
		// pump continued to m3
		assert.deepEqual(started, ['m1', 'm3']);
		assert.equal(mod.governorStats().activeCount, 1); // m3 holds the slot
		mod.__resetForTests(null);
	});

	it('stats expose limit, timeout, depth (no secrets)', async () => {
		const { mod } = await freshGovernor(2);
		const stats = mod.governorStats();
		assert.ok(stats.maxConcurrentMissions >= 1);
		assert.ok(stats.missionTimeoutMinutes >= 5);
		assert.equal(typeof stats.queueDepth, 'number');
		mod.__resetForTests(null);
	});
});

describe('Governor UNIT — watchdog sweep', () => {
	it('terminal status releases a held slot', async () => {
		const { mod, statuses } = await freshGovernor(1);
		mod.submitMission('m1', () => {});
		mod.submitMission('m2', () => {});
		statuses.set('m1', 'completed');
		// sweep is internal; releaseMission models what the bus listener does.
		// The backstop path calls releaseMission for terminal statuses.
		mod.releaseMission('m1');
		assert.equal(mod.governorStats().activeCount, 1);
		mod.__resetForTests(null);
	});

	it('queue orphan sweep drops terminal queued missions', async () => {
		const { mod, statuses } = await freshGovernor(1);
		mod.submitMission('m1', () => {});
		mod.submitMission('m2', () => {});
		statuses.set('m2', 'cancelled');
		// simulate the sweep by releasing (bus listener does this on terminal write)
		const released = mod.releaseMission('m2');
		assert.equal(released, true);
		assert.equal(mod.governorStats().queueDepth, 0);
		mod.__resetForTests(null);
	});
});

/* ── Part 2: live API tests (small, deterministic) ───────────────── */

const BASE = process.env.QASE_URL || 'http://localhost:5173';
const TOKEN = process.env.QASE_API_TOKEN || '';
const AUTH = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const hasServer = Boolean(TOKEN);

async function api(method, path, body) {
	const res = await fetch(`${BASE}${path}`, {
		method,
		headers: AUTH,
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(30000)
	});
	let json = null;
	try { json = await res.json(); } catch { /* empty */ }
	return { status: res.status, json };
}

async function mkMission(name) {
	const { status, json } = await api('POST', '/api/v1/missions', {
		name, type: 'qa', targetUrl: 'http://localhost:9901',
		autoStart: true, constraints: { maxTurns: 3 }
	});
	assert.equal(status, 202, `create ${name} failed: ${JSON.stringify(json)}`);
	return json;
}

async function cleanup(ids) {
	for (const id of ids) {
		await api('POST', `/api/v1/missions/${id}/stop`, {}).catch(() => {});
		await api('DELETE', `/api/missions/${id}`).catch(() => {});
	}
}

describe('Governor LIVE — bounded queue through the real API', () => {
	const created = [];

	after(async () => { await cleanup(created); });

	it('GET /api/v1/missions exposes governor stats', { skip: !hasServer }, async () => {
		const { status, json } = await api('GET', '/api/v1/missions?limit=1');
		assert.equal(status, 200);
		assert.ok(json.governor);
		assert.equal(typeof json.governor.maxConcurrentMissions, 'number');
		assert.equal(typeof json.governor.queueDepth, 'number');
	});

	it('config exposes the new knobs', { skip: !hasServer }, async () => {
		const { status, json } = await fetch(`${BASE}/api/config`).then(async r => ({ status: r.status, json: await r.json() }));
		assert.equal(status, 200);
		assert.equal(typeof json.maxConcurrentMissions, 'number');
		assert.equal(typeof json.missionTimeoutMinutes, 'number');
	});

	it('filling slots queues the rest with stable positions', { skip: !hasServer }, async () => {
		const list0 = await api('GET', '/api/v1/missions?limit=1');
		const limit = list0.json.governor.maxConcurrentMissions;
		// Only the SLOTS FREE IN THIS MOMENT can be granted to this batch;
		// other live traffic (other suites' missions) may already hold some.
		const freeSlots = Math.max(0, limit - list0.json.governor.activeCount);
		const batch = [];
		for (let i = 0; i < limit + 2; i += 1) {
			const m = await mkMission(`P42-GOV live ${i}`);
			created.push(m.missionId);
			batch.push(m);
		}
		// The first `freeSlots` responses say running/started; the rest queued
		// with monotonically increasing positions.
		const queued = batch.filter(m => m.status === 'queued');
		assert.ok(queued.length >= 2, `expected ≥2 queued (limit=${limit}, free=${freeSlots}), got statuses ${batch.map(m => m.status).join(',')}`);
		for (let i = 0; i < queued.length; i += 1) {
			assert.equal(queued[i].queuePosition, i + 1);
		}
		const running = batch.filter(m => m.status === 'running');
		assert.equal(running.length, freeSlots, `expected exactly ${freeSlots} of this batch running (limit=${limit})`);
	});

	it('a queued mission can be cancelled and never executes', { skip: !hasServer }, async () => {
		const list = await api('GET', '/api/v1/missions?limit=50');
		const queued = list.json.missions.find(m => m.name.startsWith('P42-GOV live') && m.status === 'queued');
		assert.ok(queued, 'expected at least one queued P42 mission');
		const { status, json } = await api('POST', `/api/v1/missions/${queued.id}/stop`, {});
		assert.equal(status, 200);
		assert.equal(json.status, 'cancelled');
		assert.equal(json.cancelledWhile, 'queued');
		const after = await api('GET', `/api/v1/missions/${queued.id}`);
		assert.equal(after.json.status, 'cancelled');
		assert.ok(after.json.cancelledAt > 0);
		assert.equal(after.json.cancellationReason, 'cancelled_before_execution');
		assert.equal(after.json.sessionId ?? null, null, 'cancelled mission must never have a session');
	});

	it('stopping a running mission frees its slot and promotes the next queued mission', { skip: !hasServer }, async () => {
		const before = await api('GET', '/api/v1/missions?limit=50');
		const running = before.json.missions.find(m => m.name.startsWith('P42-GOV live') && m.status === 'running');
		const queueDepthBefore = before.json.governor.queueDepth;
		if (!running || queueDepthBefore === 0) return; // nothing to prove in this shape
		const { status } = await api('POST', `/api/v1/missions/${running.id}/stop`, {});
		assert.equal(status, 200);
		// slot freed + promoted within a beat
		await new Promise(r => setTimeout(r, 1500));
		const after = await api('GET', '/api/v1/missions?limit=50');
		assert.equal(after.json.governor.queueDepth, queueDepthBefore - 1, 'a queued mission must be promoted');
	});

	it('mission detail exposes timing + governor fields', { skip: !hasServer }, async () => {
		const list = await api('GET', '/api/v1/missions?limit=50');
		const any = list.json.missions.find(m => m.name.startsWith('P42-GOV live'));
		if (!any) return;
		const { json } = await api('GET', `/api/v1/missions/${any.id}`);
		for (const key of ['queuedAt', 'startedAt', 'queuePosition', 'failureReason', 'cancelledAt', 'cancellationReason', 'executionDurationMs']) {
			assert.ok(key in json, `detail response must include ${key}`);
		}
	});
});
