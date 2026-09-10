/**
 * P0 auth hardening: secure default, explicit open mode, protected workspace
 * reads, and master-authorized one-time first-admin bootstrap.
 *
 * Every case runs an isolated child server with a temporary QASE_DATA_DIR.
 * No real QASE store, secret, or browser runtime is used.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'p0-test-master-token-not-a-secret';

function freePort() {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
	});
}

async function stopChild(child) {
	if (child.exitCode !== null) return;
	const exited = new Promise(resolve => child.once('exit', resolve));
	try { child.kill('SIGTERM'); } catch {}
	await Promise.race([exited, delay(2_000)]);
	if (child.exitCode !== null) return;
	const forced = new Promise(resolve => child.once('exit', resolve));
	try { child.kill('SIGKILL'); } catch {}
	await Promise.race([forced, delay(2_000)]);
}

async function boot(env = {}, label = 'p0') {
	const port = await freePort();
	const dataDir = mkdtempSync(join(tmpdir(), `qase-${label}-`));
	const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
		cwd: ROOT,
		env: {
			...process.env,
			PORT: String(port),
			QASE_DATA_DIR: dataDir,
			QASE_AUTH_MODE: '',
			QASE_API_TOKEN: '',
			QASE_ENABLE_DEMO: 'false',
			...env
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let stderr = '';
	child.stderr.on('data', chunk => { stderr += chunk.toString(); });
	const base = `http://127.0.0.1:${port}`;
	for (let attempt = 0; attempt < 80; attempt += 1) {
		if (child.exitCode !== null) throw new Error(`${label} exited early: ${stderr.slice(-500)}`);
		try {
			if ((await fetch(`${base}/api/health`)).ok) break;
		} catch { /* wait for the listener */ }
		await delay(100);
		if (attempt === 79) throw new Error(`${label} did not become healthy: ${stderr.slice(-500)}`);
	}
	return {
		base,
		async close() {
			await stopChild(child);
			try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
		}
	};
}

async function call(base, path, { method = 'GET', token, body, cookie } = {}) {
	const response = await fetch(`${base}${path}`, {
		method,
		headers: {
			'content-type': 'application/json',
			...(token ? { authorization: `Bearer ${token}` } : {}),
			...(cookie ? { cookie } : {})
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	let json = null;
	try { json = await response.json(); } catch {}
	return { status: response.status, json, headers: response.headers };
}

function sessionCookie(headers) {
	const all = headers.getSetCookie?.() ?? [headers.get('set-cookie')].filter(Boolean);
	return all.find(value => value.startsWith('qase_session='))?.split(';')[0] ?? null;
}

test('P0-A: absent, empty, and invalid modes fail closed; disabled is the only open mode', async (t) => {
	for (const [label, env, expected] of [
		['missing', {}, 401],
		['empty', { QASE_AUTH_MODE: '' }, 401],
		['invalid', { QASE_AUTH_MODE: 'invalid', QASE_API_TOKEN: TOKEN }, 401]
	]) {
		await t.test(label, async (st) => {
			const srv = await boot(env, `mode-${label}`);
			st.after(async () => srv.close());
			assert.equal((await call(srv.base, '/api/config')).status, expected);
		});
	}
	await t.test('disabled', async (st) => {
		const srv = await boot({ QASE_AUTH_MODE: 'disabled' }, 'mode-disabled');
		st.after(async () => srv.close());
		assert.equal((await call(srv.base, '/api/config')).status, 200);
		const me = await call(srv.base, '/api/auth/me');
		assert.deepEqual(me.json, { kind: 'open', mode: 'disabled' });
	});
});

test('P0-B: required mode protects all representative workspace resources', async (t) => {
	const srv = await boot({ QASE_AUTH_MODE: 'required', QASE_API_TOKEN: TOKEN }, 'protected');
	t.after(async () => srv.close());
	const protectedPaths = [
		'/api/config', '/api/sessions', '/api/findings', '/api/artifacts/run/file.png',
		'/api/test-cases', '/api/workflows', '/api/schedules', '/api/projects',
		'/api/knowledge', '/api/regression/runs', '/api/metrics/dashboard',
		'/api/fix-validations', '/api/v1/missions', '/api/sessions/missing/events'
	];
	for (const path of protectedPaths) {
		assert.equal((await call(srv.base, path)).status, 401, `${path} must reject anonymous access`);
	}
	assert.equal((await call(srv.base, '/api/health')).status, 200);
	assert.equal((await call(srv.base, '/api/v2/health')).status, 200);
	assert.equal((await call(srv.base, '/openapi.json')).status, 200);
	assert.equal((await call(srv.base, '/api/projects', { token: TOKEN })).status, 200);
});

test('P0-C: first QASE account initializes without a master token and is permanently one-time', async (t) => {
	const srv = await boot({ QASE_AUTH_MODE: 'required' }, 'bootstrap');
	t.after(async () => srv.close());
	const discovery = await call(srv.base, '/api/auth/bootstrap');
	assert.equal(discovery.status, 200);
	assert.equal(discovery.json.needsAdmin, true);
	assert.equal(discovery.json.canBootstrap, true);
	assert.equal(discovery.json.requiresMasterToken, false);
	const roleInjection = await call(srv.base, '/api/auth/register-admin', {
		method: 'POST',
		body: { email: 'first@qase.test', name: 'First', password: 'safe-bootstrap-password', role: 'viewer' }
	});
	assert.equal(roleInjection.status, 400);
	const first = await call(srv.base, '/api/auth/register-admin', {
		method: 'POST',
		body: { email: 'first@qase.test', name: 'First', password: 'safe-bootstrap-password' }
	});
	assert.equal(first.status, 200);
	assert.equal(first.json.user.role, 'admin');
	const cookie = sessionCookie(first.headers);
	assert.ok(cookie, 'bootstrap returns only an HttpOnly session cookie');
	assert.equal((await call(srv.base, '/api/projects', { cookie })).status, 200, 'the initialized QASE account can use protected workspace routes');
	assert.equal((await call(srv.base, '/api/projects')).status, 401, 'workspace routes remain closed to anonymous callers');
	assert.equal((await call(srv.base, '/api/auth/register-admin', {
		method: 'POST', body: { email: 'second@qase.test', password: 'second-bootstrap-password' }
	})).status, 403);
	assert.equal((await call(srv.base, '/api/auth/users', {
		method: 'POST', cookie, body: { email: 'viewer@qase.test', password: 'viewer-password-1', role: 'viewer' }
	})).status, 201);
	assert.equal((await call(srv.base, '/api/auth/users', {
		method: 'POST', body: { email: 'anon@qase.test', password: 'anonymous-password' }
	})).status, 401);
});

test('P0-D: concurrent account initialization requests have exactly one winner', async (t) => {
	const srv = await boot({ QASE_AUTH_MODE: 'required' }, 'bootstrap-race');
	t.after(async () => srv.close());
	const responses = await Promise.all([
		call(srv.base, '/api/auth/register-admin', { method: 'POST', body: { email: 'race-one@qase.test', password: 'race-password-one' } }),
		call(srv.base, '/api/auth/register-admin', { method: 'POST', body: { email: 'race-two@qase.test', password: 'race-password-two' } })
	]);
	assert.equal(responses.filter(r => r.status === 200).length, 1);
	assert.equal(responses.filter(r => r.status === 403).length, 1);
	const discovery = await call(srv.base, '/api/auth/bootstrap');
	assert.equal(discovery.json.needsAdmin, false);
	assert.equal(discovery.json.canBootstrap, false);
});
