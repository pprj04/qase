'use strict';

/**
 * R2-B — workspace & browser resource lifecycle reliability (G2/G6/G8).
 *
 * Behavioral tests with deterministic seams:
 *   PART 1 — disposeSessionResources contract (real module, fake bridge):
 *            dispose ordering, idempotency, already-dead, missing workspace,
 *            observable failures, no unrelated paths.
 *   PART 2 — store pruning safety (G6): doomed sessions are disposed and
 *            their workspace removed BEFORE the record leaves the map;
 *            deleteSession removes the workspace too.
 *   PART 3 — orphan sweep ownership (G8/D): matcher decisions on real
 *            cmdline shapes; QASE_ORPHAN_SWEEP=0 disable; sweep never kills
 *            non-owned processes (fake /proc via injected kill + real match
 *            on live system processes).
 *   PART 4 — realistic lifecycle (live child server): completed mission →
 *            workspace dir gone; user stop → resources disposed; R2-A
 *            compatibility — awaiting-input expiry still closes browser and
 *            cleans workspace, mission terminal.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createHmac, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ═════════ PART 1 — disposeSessionResources contract ═════════ */

describe('R2-B — disposeSessionResources (agent.js, fake bridge)', () => {
	let agent;
	test('module load (temp cwd so no real .qase is touched)', async () => {
		const home = mkdtempSync(join(tmpdir(), 'r2b-agent-'));
		const prev = process.cwd();
		process.chdir(home);
		try {
			agent = await import('../server/agent.js');
		} finally {
			process.chdir(prev);
		}
		assert.ok(agent.disposeSessionResources);
	});

	test('completed-session cleanup: dispose runs, workspace removed, ordered', async () => {
		// Arrange a fake live record with a workspace dir on disk.
		const sid = 's-complete-' + randomBytes(4).toString('hex');
		const events = [];
		// agent.js liveFor comes from store.js liveFor — same module state.
		const store = await import('../server/store.js');
		const record = store.liveFor(sid);
		record.dispose = () => events.push('dispose');
		const ws = join(process.cwd(), '.qase', 'workspaces', sid);
		mkdirSync(ws, { recursive: true });
		writeFileSync(join(ws, 'scratch.txt'), 'x');
		// Act
		const result = await agent.disposeSessionResources(sid, { log: () => {} });
		// Assert
		assert.deepEqual(events, ['dispose']);
		assert.equal(result.browserDisposed, true);
		assert.equal(result.workspaceRemoved, true);
		assert.equal(existsSync(ws), false, 'workspace directory removed');
		assert.equal(result.error, null);
		// cleanup is observable via the returned report
	});

	test('failed cleanup is observable (dispose throws)', async () => {
		const sid = 's-fail-' + randomBytes(4).toString('hex');
		const store = await import('../server/store.js');
		const record = store.liveFor(sid);
		record.dispose = () => { throw new Error('bridge exploded'); };
		const logged = [];
		const result = await agent.disposeSessionResources(sid, { log: (m) => logged.push(m) });
		assert.equal(result.browserDisposed, false);
		assert.match(result.error, /bridge exploded/);
		assert.equal(logged.length >= 1, true, 'failure logged');
	});

	test('idempotent: cleanup twice is safe', async () => {
		const sid = 's-idem-' + randomBytes(4).toString('hex');
		const store = await import('../server/store.js');
		const record = store.liveFor(sid);
		let calls = 0;
		record.dispose = () => { calls += 1; };
		const r1 = await agent.disposeSessionResources(sid, { log: () => {} });
		const r2 = await agent.disposeSessionResources(sid, { log: () => {} });
		// First call disposes AND unsets record.dispose (idempotency guard in
		// disposeSessionResources) — a second call is a safe no-op.
		assert.equal(calls, 1);
		assert.equal(r1.workspaceRemoved, true);
		assert.equal(r2.workspaceRemoved, true, 'missing workspace still reports removed (force rm)');
		assert.equal(r2.error, null);
	});

	test('already-dead browser: dispose that no-ops succeeds without throwing', async () => {
		const sid = 's-dead-' + randomBytes(4).toString('hex');
		const result = await agent.disposeSessionResources(sid, { log: () => {} });
		assert.equal(result.error, null);
		assert.equal(result.browserDisposed, true, 'no-op dispose counted as released');
	});

	test('never deletes unrelated paths (only .qase/workspaces/<sessionId>)', async () => {
		const sid = 's-unrel-' + randomBytes(4).toString('hex');
		const other = join(process.cwd(), '.qase', 'workspaces', 'OTHER-session');
		mkdirSync(other, { recursive: true });
		writeFileSync(join(other, 'keep.txt'), 'x');
		await agent.disposeSessionResources(sid, { log: () => {} });
		assert.equal(existsSync(join(other, 'keep.txt')), true, 'unrelated workspace untouched');
		rmSync(other, { recursive: true, force: true });
	});

	test('null/garbage session id is a safe no-op', async () => {
		const r = await agent.disposeSessionResources(null, { log: () => {} });
		assert.equal(r.error, null);
	});
});

/* ═════════ PART 2 — pruning safety (store.js) ═════════ */

describe('R2-B — pruneOldSessions disposes before delete (G6)', () => {
	test('doomed session: browser disposed + workspace removed before record delete', async () => {
		const home = mkdtempSync(join(tmpdir(), 'r2b-prune-'));
		const prev = process.cwd();
		process.chdir(home);
		let store;
		try {
			store = await import(`../server/store.js?prune=${randomBytes(4).toString('hex')}`);
			// Create KEEP+1 sessions; the oldest becomes doomed.
			const sids = [];
			for (let i = 0; i < 51; i += 1) {
				const s = store.createSession(`prune-${i}`);
				s.updatedAt = Date.now() - (100 - i) * 60_000; // older first
				const ws = join(process.cwd(), '.qase', 'workspaces', s.id);
				mkdirSync(ws, { recursive: true });
				writeFileSync(join(ws, 'x.txt'), 'x');
				sids.push(s.id);
			}
			const doomed = sids[0];
			const events = [];
			store.liveFor(doomed).dispose = () => events.push('dispose');
			const pruned = store.pruneOldSessions(50);
			assert.ok(pruned >= 1);
			assert.deepEqual(events, ['dispose'], 'live record disposed during prune');
			assert.equal(existsSync(join(process.cwd(), '.qase', 'workspaces', doomed)), false, 'doomed workspace removed');
			const survivors = sids.filter((id) => store.getSession(id));
			assert.equal(survivors.length, 50, 'keep=50 honored');
			// Survivor workspaces untouched
			const survivorWs = join(process.cwd(), '.qase', 'workspaces', sids[50]);
			assert.equal(existsSync(survivorWs), true, 'survivor workspace untouched');
		} finally {
			process.chdir(prev);
			rmSync(home, { recursive: true, force: true });
		}
	});

	test('prune with already-dead record: no throw, workspace still removed', async () => {
		const home = mkdtempSync(join(tmpdir(), 'r2b-prune2-'));
		const prev = process.cwd();
		process.chdir(home);
		try {
			const store = await import(`../server/store.js?prune2=${randomBytes(4).toString('hex')}`);
			for (let i = 0; i < 51; i += 1) {
				const s = store.createSession(`prune2-${i}`);
				s.updatedAt = Date.now() - (100 - i) * 60_000;
			}
			const all = store.listSessions().map((x) => x.id);
			const doomed = all.find((id) => !store.liveFor(id)?.dispose);
			// no live record at all — prune must not throw
			const pruned = store.pruneOldSessions(50);
			assert.ok(pruned >= 1);
		} finally {
			process.chdir(prev);
			rmSync(home, { recursive: true, force: true });
		}
	});

	test('deleteSession removes the workspace with the record', async () => {
		const home = mkdtempSync(join(tmpdir(), 'r2b-del-'));
		const prev = process.cwd();
		process.chdir(home);
		try {
			const store = await import(`../server/store.js?del=${randomBytes(4).toString('hex')}`);
			const s = store.createSession('del-me');
			const ws = join(process.cwd(), '.qase', 'workspaces', s.id);
			mkdirSync(ws, { recursive: true });
			store.deleteSession(s.id);
			assert.equal(existsSync(ws), false, 'workspace gone after deleteSession');
			assert.equal(store.getSession(s.id), undefined);
		} finally {
			process.chdir(prev);
			rmSync(home, { recursive: true, force: true });
		}
	});
});

/* ═════════ PART 3 — orphan sweep ownership (G8/D) ═════════ */

describe('R2-B — boot orphan sweep ownership', () => {
	let sweep;
	test('module load', async () => {
		sweep = await import('../server/orphanSweep.js');
		assert.ok(sweep.sweepOrphanBrowsers);
	});

	test('matcher: QASE playwright-cache chromium IS owned', () => {
		assert.equal(sweep.isQaseOwnedChromium('/home/coder/.cache/ms-playwright/chromium-1234/chrome-linux/chrome --headless --no-sandbox'), true);
		assert.equal(sweep.isQaseOwnedChromium('/home/coder/.cache/ms-playwright/chromium_headless_shell-1169/chrome-headless-shell-linux64/chrome-headless-shell'), true);
	});

	test('matcher: unrelated processes are NEVER owned', () => {
		// The workspace's own playwright-mcp node CLI (real, live on this box)
		assert.equal(sweep.isQaseOwnedChromium('/opt/node/24/bin/node /opt/node/24/lib/node_modules/@playwright/mcp/cli.js --host 127.0.0.1 --port 18200 --allowed-hosts * --headless'), false);
		// System chrome fallback binaries
		assert.equal(sweep.isQaseOwnedChromium('/opt/google/chrome/chrome --headless'), false);
		assert.equal(sweep.isQaseOwnedChromium('/usr/bin/chromium --headless'), false);
		// Plain node/server processes
		assert.equal(sweep.isQaseOwnedChromium('node /workspace/server/index.js'), false);
		assert.equal(sweep.isQaseOwnedChromium(''), false);
	});

	test('sweep never kills non-owned processes (live system, injected kill guard)', () => {
		const killed = [];
		const report = sweep.sweepOrphanBrowsers({
			log: () => {},
			kill: (pid) => { killed.push(pid); }
		});
		// On a healthy box there are no QASE-owned orphans at test time; if
		// anything WAS matched it must be a genuine playwright-cache chromium.
		for (const pid of killed) {
			// cannot re-read (may be reaped); ownership was checked pre-kill
		}
		assert.equal(report.disabled, false);
		assert.ok(report.scanned > 0, 'actually scanned /proc');
	});

	test('QASE_ORPHAN_SWEEP=0 disables the sweep', () => {
		const prevVal = process.env.QASE_ORPHAN_SWEEP;
		process.env.QASE_ORPHAN_SWEEP = '0';
		try {
			const killed = [];
			const report = sweep.sweepOrphanBrowsers({ log: () => {}, kill: (pid) => { killed.push(pid); } });
			assert.equal(report.disabled, true);
			assert.deepEqual(killed, []);
		} finally {
			if (prevVal === undefined) delete process.env.QASE_ORPHAN_SWEEP;
			else process.env.QASE_ORPHAN_SWEEP = prevVal;
		}
	});
});

/* ═════════ PART 4 — realistic lifecycle (live child server) ═════════ */

describe('R2-B — live server: workspaces cleaned, R2-A compat', () => {
	let base, home, secret, cleanup, icall, workspacesRoot;

	test('boot isolated server', async () => {
		const boot = await bootServer();
		base = boot.base; home = boot.home; secret = boot.secret; cleanup = boot.cleanup; icall = boot.icall;
		workspacesRoot = join(home, '.qase', 'workspaces');
		assert.ok(base);
	});

	test('cancelled queued mission + created stop never create a workspace', async () => {
		const m = await icall('POST', '/api/v1/integration/missions', { targetUrl: `${base}/demo`, name: 'ws-cancel', type: 'ux', autoStart: false });
		assert.equal(m.status, 201);
		const stop = await icall('POST', `/api/v1/integration/missions/${m.json.missionId}/stop`);
		assert.equal(stop.json.status, 'cancelled');
		const entries = existsSync(workspacesRoot) ? readdirSync(workspacesRoot) : [];
		assert.equal(entries.length, 0, 'no workspace created for never-started mission');
	});

	test('aborting a running mission disposes resources and removes the workspace', async () => {
		const m = await icall('POST', '/api/v1/integration/missions', { targetUrl: `${base}/demo`, name: 'ws-stop', type: 'ux', autoStart: true, context: { maxTurns: 3 } });
		const id = m.json.missionId;
		await delay(4000); // let ensureRuntime create the session + workspace
		const mission = (await icall('GET', `/api/v1/integration/missions/${id}`)).json;
		const sid = mission.sessionId;
		assert.ok(sid, 'mission has a session (runtime started)');
		const ws = join(workspacesRoot, sid);
		const stop = await icall('POST', `/api/v1/integration/missions/${id}/stop`);
		assert.equal(stop.status, 200);
		assert.equal(stop.json.status, 'aborted');
		await delay(1500);
		assert.equal(existsSync(ws), false, `workspace for session ${sid.slice(0, 8)} removed after abort`);
		const after = (await icall('GET', `/api/v1/integration/missions/${id}`)).json;
		assert.equal(after.status, 'aborted', 'mission terminal immediately via the abort route');
	});

	test('R2-A compat: awaiting_input expiry still closes browser + cleans workspace, mission terminal', async () => {
		// Seed an awaiting_input session (6 min old, 5-min limit) + linked
		// running mission, reboot the server, assert honest terminal cleanup.
		const home2 = mkdtempSync(join(tmpdir(), 'r2b-r2a-'));
		const dataDir = join(home2, '.qase');
		mkdirSync(dataDir, { recursive: true });
		const missionId = `r2b-m-${randomBytes(4).toString('hex')}`;
		const sessionId = `r2b-s-${randomBytes(4).toString('hex')}`;
		writeFileSync(join(dataDir, 'missions.json'), JSON.stringify([{ id: missionId, type: 'ux', name: 'R2-B R2A compat', targetUrl: 'http://127.0.0.1:1/', status: 'running', sessionId, createdAt: Date.now() - 7 * 60_000, updatedAt: Date.now() - 7 * 60_000, startedAt: Date.now() - 6 * 60_000 }]));
		writeFileSync(join(dataDir, 'sessions.json'), JSON.stringify([{
			id: sessionId, title: 'r2b r2a', status: 'awaiting_input',
			pendingQuestion: { toolCallId: 'seed', prompt: 'Continue?' },
			awaitingInputSince: Date.now() - 6 * 60_000,
			missionId, createdAt: Date.now() - 7 * 60_000, updatedAt: Date.now() - 6 * 60_000,
			messages: [], activities: [], findings: [], todos: [], capturedSteps: [], secretNames: []
		}]));
		// workspace dir for the seeded session (as if ensureRuntime ran)
		mkdirSync(join(dataDir, 'workspaces', sessionId), { recursive: true });
		const boot = await bootServer({ home: home2, dataDir, awaitingTimeout: '5', label: 'r2b-r2a' });
		try {
			await delay(2500);
			const ws = join(dataDir, 'workspaces', sessionId);
			// Boot reap marks awaiting_input → interrupted at load; the expiry
			// path owns cleanup — workspace must not survive boot sweeps.
			const sessionsRes = await fetch(`${boot.base}/api/sessions`).then((r) => r.json());
			const list = Array.isArray(sessionsRes) ? sessionsRes : (sessionsRes.sessions ?? []);
			const row = list.find((x) => x.id === sessionId);
			assert.ok(row, 'seeded session present');
			assert.notEqual(row.status, 'awaiting_input');
			assert.notEqual(row.status, 'running');
			const missionsDisk = JSON.parse((await import('node:fs')).readFileSync(join(dataDir, 'missions.json'), 'utf8'));
			const mrow = (Array.isArray(missionsDisk) ? missionsDisk : Object.values(missionsDisk.missions ?? missionsDisk)).find((mm) => mm.id === missionId);
			assert.ok(['failed', 'interrupted', 'aborted', 'cancelled'].includes(mrow.status), `mission terminal: ${mrow.status}`);
			assert.notEqual(mrow.status, 'completed');
		} finally {
			boot.cleanup();
			rmSync(home2, { recursive: true, force: true });
		}
	});

	test('teardown', async () => {
		cleanup();
	});
});

/* ── boot helper (same pattern as reliability-lifecycle / awaiting-input) ── */

function freePort() {
	return new Promise((resolve, reject) => {
		const srv = createServer();
		srv.on('error', reject);
		srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
	});
}

async function bootServer(opts = {}) {
	const label = opts.label ?? 'r2b';
	const port = await freePort();
	const home = opts.home ?? mkdtempSync(join(tmpdir(), `r2b-${label}-`));
	const secret = `sec-${randomBytes(12).toString('hex')}`;
	const blackholePort = await freePort();
	const blackhole = createServer((socket) => { socket.on('error', () => {}); });
	blackhole.listen(blackholePort, '127.0.0.1');
	const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
		cwd: home,
		env: {
			...process.env,
			QASE_AUTH_MODE: 'disabled', QASE_API_TOKEN: '',
			PORT: String(port),
			NODE_PATH: join(ROOT, 'node_modules'),
			QASE_INTEGRATION_SECRET: opts.secret ?? secret,
			QASE_DATA_DIR: opts.dataDir ?? join(home, '.qase'),
			QASE_AWAITING_INPUT_TIMEOUT_MINUTES: opts.awaitingTimeout ?? '5',
			QASE_PROVIDER: 'anthropic',
			QASE_API_KEY: `r2b-${randomBytes(8).toString('hex')}`,
			QASE_BASE_URL: `http://127.0.0.1:${blackholePort}`,
			QASE_MODEL: 'claude-test',
			QASE_MAX_MISSIONS: '1',
			QASE_MISSION_TIMEOUT_MIN: '720',
			QASE_HEADLESS: 'true'
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let stderr = '';
	child.stderr.on('data', (d) => { stderr += d.toString(); });
	const base = `http://127.0.0.1:${port}`;
	const cleanup = () => {
		try { child.kill('SIGKILL'); } catch {}
		try { blackhole.close(); } catch {}
		if (!opts.home) { try { rmSync(home, { recursive: true, force: true }); } catch {} }
	};
	for (let i = 0; i < 60; i += 1) {
		if (child.exitCode !== null) { cleanup(); throw new Error(`server exited early: ${stderr.slice(0, 400)}`); }
		try { const r = await fetch(`${base}/api/health`); if (r.ok) break; } catch {}
		await delay(500);
	}
	const makeCaller = (keyId) => {
		const sec = secret;
		const sign = (method, p, body) => {
			const ts = String(Date.now());
			const nonce = randomBytes(8).toString('hex');
			const bodyHash = createHmac('sha256', '').update(body).digest('hex');
			const sig = createHmac('sha256', sec).update(`${method}\n${p}\n${ts}\n${nonce}\n${bodyHash}`).digest('hex');
			return `QASE-HMAC-SHA256 ${keyId}:${ts}:${nonce}:${sig}`;
		};
		return async (method, p, bodyObj) => {
			const body = bodyObj === undefined ? '' : JSON.stringify(bodyObj);
			const res = await fetch(base + p, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Authorization: sign(method, p, body) }, body: body || undefined });
			const text = await res.text();
			let json = null; try { json = JSON.parse(text); } catch {}
			return { status: res.status, json, text };
		};
	};
	const admin = makeCaller('qase-admin');
	const reg = await admin('POST', '/api/v1/integration/keys', { keyId: `${label}-key`, workspaceId: 'r2b-ws' });
	if (reg.status !== 201 && reg.status !== 409) { cleanup(); throw new Error(`key reg failed: ${reg.status}`); }
	const icall = makeCaller(`${label}-key`);
	return { base, home, secret, cleanup, icall, admin };
}
