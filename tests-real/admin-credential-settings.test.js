/**
 * Credential Settings authorization regression suite.
 *
 * Runs against disposable required-mode servers so it can prove both models:
 * an Admin browser session works with no QASE_API_TOKEN configured, while a
 * separate machine server keeps valid master bearer access and rejects an
 * invalid bearer. Test-only dummy values never leave the local process.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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

async function bootServer(label, env = {}) {
	const port = await freePort();
	const dataDir = mkdtempSync(join(tmpdir(), `qase-credential-settings-${label}-`));
	const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
		cwd: ROOT,
		env: {
			...process.env,
			PORT: String(port),
			QASE_DATA_DIR: dataDir,
			QASE_AUTH_MODE: 'required',
			QASE_API_TOKEN: '',
			QASE_API_KEY: '',
			ANTHROPIC_API_KEY: '',
			QASE_BROWSERSTACK_KEY: '',
			BROWSERSTACK_ACCESS_KEY: '',
			...env
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let stderr = '';
	child.stderr.on('data', (chunk) => { stderr += String(chunk); });
	const base = `http://127.0.0.1:${port}`;
	const cleanup = async () => {
		if (child.exitCode === null) {
			const exited = new Promise(resolve => child.once('exit', resolve));
			child.kill('SIGTERM');
			await Promise.race([exited, delay(2_000)]);
			if (child.exitCode === null) child.kill('SIGKILL');
		}
		try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
	};
	for (let attempt = 0; attempt < 60; attempt += 1) {
		if (child.exitCode !== null) {
			await cleanup();
			throw new Error(`${label} server exited early: ${stderr.slice(0, 500)}`);
		}
		try {
			if ((await fetch(`${base}/api/health`)).ok) return { base, cleanup };
		} catch { /* server is still starting */ }
		await delay(100);
	}
	await cleanup();
	throw new Error(`${label} server did not become healthy: ${stderr.slice(0, 500)}`);
}

async function call(base, path, { method = 'GET', cookie, token, body } = {}) {
	const response = await fetch(`${base}${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(cookie ? { Cookie: cookie } : {}),
			...(token ? { Authorization: `Bearer ${token}` } : {})
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	let json = null;
	try { json = await response.json(); } catch { /* non-JSON responses are irrelevant here */ }
	return { status: response.status, json, headers: response.headers };
}

function sessionCookie(headers) {
	const cookies = headers.getSetCookie?.() ?? [headers.get('set-cookie')].filter(Boolean);
	const value = cookies.find(cookie => cookie.startsWith('qase_session='));
	assert.ok(value, 'expected a QASE user-session cookie');
	return value.split(';')[0];
}

async function bootstrapAdmin(base) {
	const email = 'admin@credential-settings.test';
	const password = 'admin-password-test-only';
	const response = await call(base, '/api/auth/register-admin', {
		method: 'POST', body: { email, password, name: 'Credential Admin' }
	});
	assert.equal(response.status, 200, `bootstrap failed: ${JSON.stringify(response.json)}`);
	return { cookie: sessionCookie(response.headers), email, password };
}

test('credential Settings: session Admin works without QASE_API_TOKEN; all other callers stay constrained', async (t) => {
	const server = await bootServer('session-no-master');
	t.after(server.cleanup);
	const { base } = server;

	await t.test('anonymous config read and credential write are 401', async () => {
		assert.equal((await call(base, '/api/config')).status, 401);
		assert.equal((await call(base, '/api/config', { method: 'PUT', body: { apiKey: 'dummy-provider-key-0001' } })).status, 401);
		assert.equal((await call(base, '/api/config/test', { method: 'POST', body: {} })).status, 401);
	});

	const admin = await bootstrapAdmin(base);
	let operatorCookie;
	await t.test('normal authenticated user cannot access credential settings', async () => {
		const created = await call(base, '/api/auth/users', {
			method: 'POST', cookie: admin.cookie,
			body: { email: 'operator@credential-settings.test', password: 'operator-password-test-only', role: 'operator' }
		});
		assert.equal(created.status, 201);
		const login = await call(base, '/api/auth/login', {
			method: 'POST', body: { email: 'operator@credential-settings.test', password: 'operator-password-test-only' }
		});
		assert.equal(login.status, 200);
		operatorCookie = sessionCookie(login.headers);
		const read = await call(base, '/api/config', { cookie: operatorCookie });
		assert.equal(read.status, 200, 'non-admin only gets the existing sanitized bootstrap projection');
		for (const field of ['apiKeyHint', 'hasApiKey', 'browserstackUser', 'hasBrowserstackKey']) {
			assert.ok(!(field in read.json), `non-admin response exposed ${field}`);
		}
		assert.equal((await call(base, '/api/config', { method: 'PUT', cookie: operatorCookie, body: { apiKey: 'dummy-provider-key-0001' } })).status, 403);
		assert.equal((await call(base, '/api/config/test', { method: 'POST', cookie: operatorCookie, body: {} })).status, 403);
		assert.equal((await call(base, '/api/config/test-browserstack', { method: 'POST', cookie: operatorCookie, body: {} })).status, 403);
	});

	await t.test('Admin session reads masked state and saves/updates/deletes provider credentials without a bearer token', async () => {
		const initial = await call(base, '/api/config', { cookie: admin.cookie });
		assert.equal(initial.status, 200);
		assert.equal(initial.json.hasApiToken, undefined, 'machine token state is not exposed to browser sessions');

		const providerKey = 'dummy-provider-key-1234';
		const saved = await call(base, '/api/config', {
			method: 'PUT', cookie: admin.cookie,
			body: { provider: 'openai', model: 'test-model', apiKey: providerKey }
		});
		assert.equal(saved.status, 200);
		assert.ok(!JSON.stringify(saved.json).includes(providerKey), 'save response must not echo provider key');

		const loaded = await call(base, '/api/config', { cookie: admin.cookie });
		assert.equal(loaded.status, 200);
		assert.equal(loaded.json.hasApiKey, true);
		assert.match(loaded.json.apiKeyHint, /1234$/);
		assert.ok(!JSON.stringify(loaded.json).includes(providerKey), 'read response must not return provider key');

		const updatedKey = 'dummy-provider-key-9876';
		const updated = await call(base, '/api/config', { method: 'PUT', cookie: admin.cookie, body: { apiKey: updatedKey } });
		assert.equal(updated.status, 200);
		assert.ok(!JSON.stringify(updated.json).includes(updatedKey));
		const reloaded = await call(base, '/api/config', { cookie: admin.cookie });
		assert.match(reloaded.json.apiKeyHint, /9876$/);

		const deleted = await call(base, '/api/config', { method: 'PUT', cookie: admin.cookie, body: { clearApiKey: true } });
		assert.equal(deleted.status, 200);
		const afterDelete = await call(base, '/api/config', { cookie: admin.cookie });
		assert.equal(afterDelete.json.hasApiKey, false);
	});

	await t.test('Admin session saves and clears BrowserStack credentials without secret echo', async () => {
		const browserstackKey = 'dummy-browserstack-key-5678';
		const saved = await call(base, '/api/config', {
			method: 'PUT', cookie: admin.cookie,
			body: { browserstackUser: 'dummy-browserstack-user', browserstackKey }
		});
		assert.equal(saved.status, 200);
		assert.ok(!JSON.stringify(saved.json).includes(browserstackKey));
		const loaded = await call(base, '/api/config', { cookie: admin.cookie });
		assert.equal(loaded.json.hasBrowserstackKey, true);
		assert.equal(loaded.json.browserstackUser, 'dummy-browserstack-user');
		assert.ok(!JSON.stringify(loaded.json).includes(browserstackKey));
		assert.equal((await call(base, '/api/config', { method: 'PUT', cookie: admin.cookie, body: { browserstackKey: '' } })).status, 200);
		const cleared = await call(base, '/api/config', { cookie: admin.cookie });
		assert.equal(cleared.json.hasBrowserstackKey, false);
	});

	await t.test('Admin session may not alter the machine master token', async () => {
		const response = await call(base, '/api/config', { method: 'PUT', cookie: admin.cookie, body: { apiToken: 'not-allowed-from-browser' } });
		assert.equal(response.status, 403);
	});

	await t.test('Admin session reaches provider test without a master bearer', async () => {
		const response = await call(base, '/api/config/test', {
			method: 'POST', cookie: admin.cookie,
			// No base URL means the provider probe exits before making a network call.
			body: { provider: 'custom', model: 'test-model', apiKey: 'dummy-provider-key-9999', baseUrl: '' }
		});
		assert.equal(response.status, 200);
		assert.equal(response.json.ok, false);
		assert.equal(response.json.diagnostic.category, 'INVALID_CONFIGURATION');
	});
});

test('credential Settings: valid machine master bearer remains compatible and invalid bearer is denied', async (t) => {
	const token = 'machine-master-token-test-only';
	const server = await bootServer('machine-bearer', { QASE_API_TOKEN: token });
	t.after(server.cleanup);

	const valid = await call(server.base, '/api/config', {
		method: 'PUT', token, body: { apiKey: 'machine-provider-key-2468' }
	});
	assert.equal(valid.status, 200);
	assert.ok(!JSON.stringify(valid.json).includes('machine-provider-key-2468'));
	assert.equal((await call(server.base, '/api/config', { token })).status, 200);
	assert.equal((await call(server.base, '/api/config', { token: 'invalid-machine-token' })).status, 401);
	assert.equal((await call(server.base, '/api/config', { method: 'PUT', token: 'invalid-machine-token', body: {} })).status, 401);
});
