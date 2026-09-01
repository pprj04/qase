/**
 * QASE_AUTH_MODE — configurable authentication.
 *
 * Contract under test (spec: .drytis/specs/qase-auth-mode.md):
 *
 *  disabled mode (QASE_AUTH_MODE=disabled):
 *   1. GET /                  → 200 (UI serves)
 *   2. GET /api/config        → 200 anonymous (boot fetch — login gate never arms)
 *   3. GET /api/auth/me       → { kind: 'open', mode: 'disabled' }
 *   4. POST /api/v1/missions  → not 401/403 (accepted by the auth layer)
 *   5. POST /api/v1/missions/:id/start → not 401/403
 *   6. GET /api/findings     → 200 anonymous
 *   7. GET /api/v2/health    → 200 anonymous
 *
 *  required mode (QASE_AUTH_MODE unset + QASE_API_TOKEN set):
 *   8. GET /api/config        → 401 anonymous
 *   9. wrong Bearer token     → 401
 *  10. POST /api/v1/missions  → 401 anonymous
 *  11. GET /api/auth/me       → 401 anonymous
 *
 *  legacy mode (QASE_AUTH_MODE unset + no token configured):
 *  12. open access unchanged (GET /api/config → 200 anonymous)
 *
 * Isolation: each mode boots its own child server on a free port with its
 * own env; nothing touches the dev server on :5173 or its stores.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Grab a free TCP port by binding :0 and releasing it. */
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

/**
 * Boot an isolated server/index.js child with the given env.
 * Each child gets its OWN temp cwd (.qase/ resolves relative to cwd in
 * store.js), so no dev stores are touched and no dev apiToken leaks in.
 * Resolves on /api/health 200.
 */
async function bootServer(env, label) {
	const port = await freePort();
	const home = mkdtempSync(join(tmpdir(), `qase-authmode-${label}-`));
	writeFileSync(join(home, 'config-seed.json'), '{}'); // placeholder to document intent
	const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
		cwd: home,
		env: {
			...process.env,
			// Isolate auth + config from the dev shell: each child decides its
			// own mode; the dev .env token must not leak into any scenario.
			QASE_AUTH_MODE: '',
			QASE_API_TOKEN: '',
			QASE_PORT: '',
			PORT: String(port),
			// server modules resolve relative to cwd for node_modules — point back at the app root.
			NODE_PATH: join(ROOT, 'node_modules'),
			...env
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let stderr = '';
	child.stderr.on('data', (d) => { stderr += d.toString(); });
	const base = `http://127.0.0.1:${port}`;
	const cleanup = () => { try { child.kill('SIGKILL'); } catch {} try { rmSync(home, { recursive: true, force: true }); } catch {} };
	for (let i = 0; i < 60; i += 1) {
		if (child.exitCode !== null) { cleanup(); throw new Error(`${label} server exited early (${child.exitCode}): ${stderr.slice(0, 500)}`); }
		try {
			const r = await fetch(`${base}/api/health`);
			if (r.ok) return { child, base, cleanup };
		} catch { /* not up yet */ }
		await delay(500);
	}
	cleanup();
	throw new Error(`${label} server did not become healthy. stderr: ${stderr.slice(0, 800)}`);
}

async function call(base, path, { method = 'GET', token, body } = {}) {
	const response = await fetch(`${base}${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {})
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
	});
	let json = null;
	try { json = await response.json(); } catch { /* non-JSON */ }
	return { status: response.status, json, text: null };
}

/** Create a mission in a child server; returns the missionId (v1 contract: { missionId, status }). */
async function createMission(base) {
	const res = await call(base, '/api/v1/missions', {
		method: 'POST',
		body: { name: 'auth-mode smoke', targetUrl: 'http://127.0.0.1:9901/', objectives: ['open the app'], constraints: { browser: 'chrome', provider: 'local' } }
	});
	return res.json?.missionId ?? res.json?.mission?.id ?? null;
}

test('disabled mode — UI, config, identity, missions, findings, v2 all open', async (t) => {
	const srv = await bootServer({ QASE_AUTH_MODE: 'disabled' }, 'disabled');
	t.after(() => srv.cleanup());

	await t.test('1. GET / serves the SPA', async () => {
		const r = await fetch(`${srv.base}/`);
		assert.equal(r.status, 200);
		assert.match(await r.text(), /<html/i);
	});

	await t.test('2. GET /api/config anonymous → 200 (gate never arms)', async () => {
		const r = await call(srv.base, '/api/config');
		assert.equal(r.status, 200);
	});

	await t.test('3. GET /api/auth/me → kind open', async () => {
		const r = await call(srv.base, '/api/auth/me');
		assert.equal(r.status, 200);
		assert.equal(r.json.kind, 'open');
		assert.equal(r.json.mode, 'disabled');
	});

	await t.test('4. POST /api/v1/missions anonymous — accepted by auth layer', async () => {
		const r = await call(srv.base, '/api/v1/missions', { method: 'POST', body: { targetUrl: 'http://127.0.0.1:9901/', constraints: { provider: 'local' } } });
		assert.notEqual(r.status, 401, `unexpected 401: ${JSON.stringify(r.json)}`);
		assert.notEqual(r.status, 403, `unexpected 403: ${JSON.stringify(r.json)}`);
	});

	let missionId = null;
	await t.test('5. POST /api/v1/missions/:id/start anonymous — accepted by auth layer', async () => {
		missionId = await createMission(srv.base);
		assert.ok(missionId, `mission id not returned by create: ${JSON.stringify((await call(srv.base, '/api/v1/missions', { method: 'POST', body: { targetUrl: 'http://127.0.0.1:9901/' } })).json)}`);
		const r = await call(srv.base, `/api/v1/missions/${missionId}/start`, { method: 'POST', body: {} });
		assert.notEqual(r.status, 401, `unexpected 401: ${JSON.stringify(r.json)}`);
		assert.notEqual(r.status, 403, `unexpected 403: ${JSON.stringify(r.json)}`);
	});

	await t.test('6. GET /api/findings anonymous → 200', async () => {
		const r = await call(srv.base, '/api/findings');
		assert.equal(r.status, 200);
		assert.ok(Array.isArray(r.json));
	});

	await t.test('7. GET /api/v2/health anonymous → 200', async () => {
		const r = await call(srv.base, '/api/v2/health');
		assert.equal(r.status, 200);
	});
});

test('required mode — enforcement unchanged (401 everywhere without credentials)', async (t) => {
	const TOKEN = 'test-master-token-do-not-use';
	const srv = await bootServer({ QASE_AUTH_MODE: 'required', QASE_API_TOKEN: TOKEN }, 'required');
	t.after(() => srv.cleanup());

	await t.test('8. GET /api/config anonymous → 401', async () => {
		const r = await call(srv.base, '/api/config');
		assert.equal(r.status, 401);
	});

	await t.test('9. wrong Bearer token → 401', async () => {
		const r = await call(srv.base, '/api/config', { token: 'definitely-not-the-token' });
		assert.equal(r.status, 401);
	});

	await t.test('10. POST /api/v1/missions anonymous → 401', async () => {
		const r = await call(srv.base, '/api/v1/missions', { method: 'POST', body: { targetUrl: 'http://127.0.0.1:9901/' } });
		assert.equal(r.status, 401);
	});

	await t.test('11. GET /api/auth/me anonymous → 401', async () => {
		const r = await call(srv.base, '/api/auth/me');
		assert.equal(r.status, 401);
	});

	await t.test('11b. valid Bearer still passes (enforcement is exact, not blanket-open)', async () => {
		const r = await call(srv.base, '/api/config', { token: TOKEN });
		assert.equal(r.status, 200);
	});
});

test('legacy mode — no token configured keeps historical open access', async (t) => {
	const srv = await bootServer({}, 'legacy');
	t.after(() => srv.cleanup());

	await t.test('12. GET /api/config anonymous → 200 (pre-existing behavior)', async () => {
		const r = await call(srv.base, '/api/config');
		assert.equal(r.status, 200);
	});
});
