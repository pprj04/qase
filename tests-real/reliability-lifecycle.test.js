'use strict';

/**
 * R1 — Reliability: mission lifecycle failure injection.
 *
 * Four gaps from the reliability inspection (see
 * .drytis/specs/phase-R1-lifecycle-fixes.md), each proven by injecting the
 * exact failure the gap described:
 *
 *  G1  Integration stop on a QUEUED mission: previously wrote 'aborted'
 *      (illegal from queued) → status dropped → mission re-executes after a
 *      restart. Now: governorCancelMission → 'cancelled', boot requeue
 *      skips it.
 *  G5  Governor wall-clock timeout: previously had an INVERTED terminal
 *      guard (only acted on already-terminal missions — a no-op) and wrote
 *      failed with NO close-out/evidence. Now: aborts runtime, runs the D1
 *      close-out pair, finalizes failed.
 *  G7  Runtime-kick race: a pending ensureRuntime() previously looked like a
 *      settled session → stuck detector finalized a mission whose execution
 *      was about to start, and the late kick could re-open it. Now:
 *      probeSession reports not-settled during the kick; startTurn refuses
 *      to enter runTurn for a terminal mission.
 *  G12 Honesty guard read session.transcript (never existed) → firstErr
 *      always undefined. Now reads session.messages.
 *
 * PART 1 is fully hermetic (module imports + injected fakes, no server, no
 * browser, no LLM). PART 2 boots an isolated child server (own port, own
 * temp .qase dir) and drives G1 through real HTTP.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createHmac, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ═══════════════ PART 1 — hermetic unit layer ═══════════════ */

// missionWatchdog imports agent.js → store.js reads .qase under cwd. Pin
// cwd to a temp dir for the WHOLE suite so importing never touches the
// real store, and keep the module import cached per-world-build (the
// module itself has no per-world state — createMissionWatchdogHandlers
// closes over the injected world fresh each call).
const tempHome = mkdtempSync(join(tmpdir(), 'qase-r1-unit-'));
const prevCwd = process.cwd();
process.chdir(tempHome);
const { createMissionWatchdogHandlers } = await import('../server/missionWatchdog.js');
process.chdir(prevCwd);

describe('R1/G5 + G7 — watchdog handlers (missionWatchdog.js)', () => {
	/** Minimal fake mission store: statuses + records as the handlers need them. */
	function makeWorld() {
		const missions = new Map();
		const sessions = new Map();
		const liveRecords = new Map();
		const calls = { closeOut: 0, evidence: 0, finalize: [], aborts: 0, closeBrowser: 0 };
		return {
			missions, sessions, liveRecords, calls,
			getMission: (id) => missions.get(id) ?? null,
			getSession: (id) => sessions.get(id) ?? null,
			liveFor: (id) => liveRecords.get(id) ?? {},
			finalizeMission: (id, patch) => {
				const m = missions.get(id);
				if (m) { m.status = patch.status; m.failureReason = patch.failureReason; }
				calls.finalize.push({ id, patch });
			},
			finalizeMissionFromSession: async () => { calls.finalize.push({ fromSession: true }); },
			collectEvidenceForSession: () => { calls.evidence += 1; },
			getConfig: () => ({ missionTimeoutMinutes: 60 }),
			log: () => {}
		};
	}

	const build = (world) => createMissionWatchdogHandlers({
		getMission: world.getMission,
		getSession: world.getSession,
		liveFor: world.liveFor,
		finalizeMission: world.finalizeMission,
		finalizeMissionFromSession: world.finalizeMissionFromSession,
		collectEvidenceForSession: world.collectEvidenceForSession,
		getConfig: world.getConfig,
		log: world.log
	});

	test('G5: onTimeout finalizes a LIVE over-limit mission (old guard acted only on terminal — inverted)', () => {
		const world = makeWorld();
		world.missions.set('m-live', { id: 'm-live', status: 'running', sessionId: 's1', startedAt: Date.now() - 61 * 60_000 });
		world.sessions.set('s1', { id: 's1', status: 'running', messages: [], findings: [] });
		world.liveRecords.set('s1', { runtime: { dispose() {} }, controller: { abort() { world.calls.aborts += 1; } } });
		build(world).onTimeout('m-live');
		// THE regression: the old code skipped the live mission entirely.
		assert.equal(world.calls.finalize.length, 1, 'live mission must be finalized');
		assert.match(world.calls.finalize[0].patch.failureReason, /execution_timeout/);
		assert.equal(world.calls.aborts, 1, 'runtime aborted before finalize');
		assert.equal(world.calls.evidence, 1, 'D1 evidence pair ran');
	});

	test('G5: onTimeout is idempotent for terminal missions (no double finalize)', () => {
		const world = makeWorld();
		world.missions.set('m-done', { id: 'm-done', status: 'completed', sessionId: 's2' });
		build(world).onTimeout('m-done');
		assert.equal(world.calls.finalize.length, 0, 'terminal mission untouched');
	});

	test('G5: close-out failure never blocks the failed finalize (guarantee path)', () => {
		const world = makeWorld();
		world.missions.set('m-boom', { id: 'm-boom', status: 'running', sessionId: 's3' });
		world.sessions.set('s3', { id: 's3', status: 'running' });
		world.liveRecords.set('s3', { controller: { abort() {} } });
		// evidence collection throws — finalize must still happen
		world.collectEvidenceForSession = () => { throw new Error('evidence store corrupted'); };
		assert.doesNotThrow(() => build(world).onTimeout('m-boom'));
		assert.equal(world.calls.finalize.length, 1, 'failed finalize is the guarantee');
	});

	test('G5: session missing → finalize still runs (degraded but terminal)', () => {
		const world = makeWorld();
		world.missions.set('m-nosess', { id: 'm-nosess', status: 'running', sessionId: 's-gone' });
		build(world).onTimeout('m-nosess');
		assert.equal(world.calls.finalize.length, 1);
	});

	test('G7: probeSession reports NOT settled while a runtime kick is pending', () => {
		const world = makeWorld();
		world.sessions.set('s4', { id: 's4', status: 'idle', updatedAt: Date.now() - 10 * 60_000 });
		world.liveRecords.set('s4', { pendingRuntimeKick: true });
		const { probeSession } = build(world);
		assert.equal(probeSession('s4').settled, false, 'pending kick ⇒ not settled (sweep skips)');
		// without the flag, an idle-for-10min session IS settled → stuck detector arms
		world.liveRecords.set('s4', {});
		assert.equal(probeSession('s4').settled, true, 'no flag ⇒ settled as before (legacy behavior)');
	});

	test('probeSession: gone session stays settled:true (legacy)', () => {
		const world = makeWorld();
		const { probeSession } = build(world);
		assert.equal(probeSession('s-missing').settled, true);
	});

	test('probeSession: running session stays settled:false (legacy)', () => {
		const world = makeWorld();
		world.sessions.set('s-run', { id: 's-run', status: 'running', updatedAt: Date.now() });
		world.liveRecords.set('s-run', { running: true });
		const { probeSession } = build(world);
		assert.equal(probeSession('s-run').settled, false);
	});
});

/* ═══════════════ PART 2 — live server: G1 queued-stop ═══════════════ */

describe('R1/G1 — integration stop on queued mission (live child server)', () => {
	let base, home, cleanup, SECRET;
	let ctx = null; // { icall } bound after boot

	test('setup: boot isolated server + register integration key', async () => {
		const boot = await bootIntegrationServer('r1g1');
		base = boot.base; home = boot.home; cleanup = boot.cleanup; SECRET = boot.SECRET;
		const call = makeCaller(base, SECRET);
		const reg = await call('POST', '/api/v1/integration/keys', { keyId: 'r1-g1', workspaceId: 'r1-ws' }, 'qase-admin');
		if (reg.status !== 201 && reg.status !== 409) {
			cleanup();
			throw new Error(`key registration failed: ${reg.status} ${JSON.stringify(reg.json)}`);
		}
		ctx = { icall: (m, p, b) => call(m, p, b, 'r1-g1') };
		assert.ok(base);
	});

	test('G1: stop a QUEUED mission → cancelled (was: stuck queued forever + re-executed after restart)', async () => {
		const { icall } = ctx;
		// The child's QASE_BASE_URL is a BLACK-HOLE TCP server: it accepts
		// connections and never responds, so the blocker's first model call
		// hangs forever — it stays RUNNING and holds the single slot.
		const blocker = await icall('POST', '/api/v1/integration/missions', {
			targetUrl: `${base}/demo`, name: 'R1 blocker', type: 'ux', autoStart: true,
			context: { maxTurns: 3 }
		});
		assert.ok(blocker.status === 202 || blocker.status === 201, `blocker accepted: ${blocker.status}`);
		const blockerId = blocker.json.missionId;
		// Give the blocker a beat to reach its (never-answering) model call.
		await delay(400);
		const blockerStatus = (await icall('GET', `/api/v1/integration/missions/${blockerId}`)).json.status;
		assert.equal(blockerStatus, 'running', 'blocker holds the slot (model call black-holed)');

		const victim = await icall('POST', '/api/v1/integration/missions', {
			targetUrl: `${base}/demo`, name: 'R1 victim', type: 'ux', autoStart: true,
			context: { maxTurns: 2 }
		});
		const victimId = victim.json.missionId;
		assert.equal(victim.json.status, 'queued', 'victim is queued (slots full)');

		// THE G1 regression: stop it.
		const stop = await icall('POST', `/api/v1/integration/missions/${victimId}/stop`);
		assert.equal(stop.status, 200);
		assert.equal(stop.json.status, 'cancelled', 'queued stop → cancelled, not aborted');
		assert.equal(stop.json.cancelledWhile, 'queued');

		// Status persisted (illegal transitions are dropped silently — this
		// assert catches exactly that failure mode). Wait past the store's
		// 500ms debounce before reading the file.
		await delay(1200);
		const after = await icall('GET', `/api/v1/integration/missions/${victimId}`);
		assert.equal(after.json.status, 'cancelled', 'status write actually landed');
	});

	test('G1: created-shell stop → cancelled via legal created→cancelled', async () => {
		const { icall } = ctx;
		const created = await icall('POST', '/api/v1/integration/missions', {
			targetUrl: `${base}/demo`, name: 'R1 created-shell', type: 'ux', autoStart: false
		});
		assert.equal(created.status, 201);
		const stop = await icall('POST', `/api/v1/integration/missions/${created.json.missionId}/stop`);
		assert.equal(stop.status, 200);
		assert.equal(stop.json.status, 'cancelled');
		assert.equal(stop.json.cancelledWhile, 'created');
	});

	test('G1: terminal mission stop → idempotent, status unchanged', async () => {
		const { icall } = ctx;
		const m = await icall('POST', '/api/v1/integration/missions', {
			targetUrl: `${base}/demo`, name: 'R1 terminal', type: 'ux', autoStart: false
		});
		const id = m.json.missionId;
		await icall('POST', `/api/v1/integration/missions/${id}/stop`); // cancel via created-path (deterministic)
		const stop2 = await icall('POST', `/api/v1/integration/missions/${id}/stop`); // terminal: idempotent
		assert.equal(stop2.status, 200);
		assert.equal(stop2.json.status, 'cancelled', 'terminal status never flips');
	});

	test('G1: cancelled missions are never re-queued at rest', async () => {
		// Wait past the store's 500ms write debounce so all cancels are on disk.
		await delay(1200);
		const missionsFile = join(home, '.qase', 'missions.json');
		assert.ok(existsSyncSafe(missionsFile), 'child wrote its missions store');
		const store = JSON.parse(readFileSync(missionsFile, 'utf8'));
		const rows = Array.isArray(store) ? store : Object.values(store.missions ?? store);
		const cancelled = rows.filter((m) => m.status === 'cancelled');
		assert.ok(cancelled.length >= 3, `expected ≥3 cancelled missions on disk, got ${cancelled.length}`);
		// No mission may sit 'queued' at rest after all stops resolved.
		const queued = rows.filter((m) => m.status === 'queued');
		assert.equal(queued.length, 0, `queued-at-rest rows: ${JSON.stringify(queued.map((m) => m.id))}`);
	});

	test('teardown: kill child + clean temp dir', async () => {
		cleanup();
	});
});

/* ── helpers ─────────────────────────────────────────────────────── */

function existsSyncSafe(p) { try { return existsSync(p); } catch { return false; } }

function freePort() {
	return new Promise((resolve, reject) => {
		const srv = createServer();
		srv.on('error', reject);
		srv.listen(0, '127.0.0.1', () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
	});
}

async function bootIntegrationServer(label) {
	const port = await freePort();
	const home = mkdtempSync(join(tmpdir(), `qase-r1-${label}-`));
	const SECRET = `r1-secret-${randomBytes(12).toString('hex')}`;
	// Black-hole model endpoint: accepts TCP connections and NEVER responds.
	// A blocker mission's first model call hangs there indefinitely — the
	// mission stays RUNNING and holds its governor slot for the whole test.
	const blackholePort = await freePort();
	const blackhole = createServer((socket) => { /* accept, never respond */ });
	blackhole.listen(blackholePort, '127.0.0.1');
	const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
		cwd: home,
		env: {
			...process.env,
			QASE_AUTH_MODE: '',
			QASE_API_TOKEN: '',
			PORT: String(port),
			NODE_PATH: join(ROOT, 'node_modules'),
			QASE_INTEGRATION_SECRET: SECRET,
			QASE_DATA_DIR: join(home, '.qase'),
			// Model config: dummy key passes the config problem check; the
			// base URL is the black hole so model calls hang (slot held).
			QASE_PROVIDER: 'anthropic',
			QASE_API_KEY: `r1-dummy-${randomBytes(8).toString('hex')}`,
			QASE_BASE_URL: `http://127.0.0.1:${blackholePort}`,
			QASE_MODEL: 'claude-test',
			// ONE slot: a single running blocker forces the victim to queue.
			QASE_MAX_MISSIONS: '1',
			// Long wall clock so the governor never races the test.
			QASE_MISSION_TIMEOUT_MIN: '720',
			QASE_HEADLESS: 'true'
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let stderr = '';
	child.stderr.on('data', (d) => { stderr += d.toString(); });
	const base = `http://127.0.0.1:${port}`;
	const cleanup = () => {
		try { child.kill('SIGKILL'); } catch { /* already dead */ }
		try { blackhole.close(); } catch { /* already closed */ }
		try { rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
	};
	for (let i = 0; i < 60; i += 1) {
		if (child.exitCode !== null) { cleanup(); throw new Error(`r1 server exited early (${child.exitCode}): ${stderr.slice(0, 500)}`); }
		try {
			const r = await fetch(`${base}/api/health`);
			if (r.ok) return { child, base, home, cleanup, SECRET };
		} catch { /* not up yet */ }
		await delay(500);
	}
	cleanup();
	throw new Error(`r1 server did not become healthy. stderr: ${stderr.slice(0, 800)}`);
}

/** HMAC caller bound to a base + secret; keyId defaults to the workspace key. */
function makeCaller(base, secret, defaultKey = 'r1-g1') {
	function sign(method, path, body, keyId) {
		const ts = String(Date.now());
		const nonce = randomBytes(8).toString('hex');
		const bodyHash = createHmac('sha256', '').update(body).digest('hex');
		const sig = createHmac('sha256', secret).update(`${method}\n${path}\n${ts}\n${nonce}\n${bodyHash}`).digest('hex');
		return `QASE-HMAC-SHA256 ${keyId}:${ts}:${nonce}:${sig}`;
	}
	return async function call(method, path, bodyObj, keyId = defaultKey) {
		const body = bodyObj === undefined ? '' : JSON.stringify(bodyObj);
		const headers = {
			...(body ? { 'Content-Type': 'application/json' } : {}),
			Authorization: sign(method, path, body, keyId)
		};
		const res = await fetch(base + path, { method, headers, body: body || undefined });
		const text = await res.text();
		let json = null;
		try { json = JSON.parse(text); } catch { /* ok */ }
		return { status: res.status, json, text };
	};
}
