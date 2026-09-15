/** PF-1A — new-user onboarding and managed-provider security contracts. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');
const read = path => readFileSync(join(root, path), 'utf8');
const shellSource = read('public/shell.js');
const loginSource = read('public/login.js');
const newRunSource = read('public/newRun.js');
const appSource = read('public/app.js');
const htmlSource = read('public/index.html');
const configSource = read('server/config.js');
const indexSource = read('server/index.js');

test('PF-1A frontend and architecture contracts', async t => {
	await t.test('regular internal operator is presented as Member', () => {
		assert.match(shellSource, /who\?\.role === 'operator'\) return 'Member'/);
		assert.doesNotMatch(shellSource, /textContent = isUser \? \(who\.role/);
	});

	await t.test('internal RBAC role names remain unchanged', () => {
		assert.match(read('server/userStore.js'), /admin\|operator\|viewer|\['admin', 'operator', 'viewer'\]/);
		assert.match(indexSource, /role: 'operator', createdBy: 'signup'/);
	});

	await t.test('successful login enters Overview', () => {
		assert.match(loginSource, /location\.replace\(signup && !bootstrap \? '\/login\?created=1' : '\/overview'\)/);
	});

	await t.test('New Run uses provider-neutral readiness and never collects a provider key', () => {
		assert.match(newRunSource, /state\.config\?\.executionReady === false/);
		assert.match(newRunSource, /Workspace setup required/);
		const dialog = htmlSource.slice(htmlSource.indexOf('id="new-run-dialog"'), htmlSource.indexOf('<div class="toasts"'));
		assert.doesNotMatch(dialog, /api.?key|provider|base.?url|model.?id/i);
	});

	await t.test('regular users are not forced into administrator Settings', () => {
		assert.match(appSource, /state\.auth\?\.kind === 'master' \|\| state\.auth\?\.role === 'admin'/);
		assert.doesNotMatch(newRunSource, /openSettings/);
	});

	await t.test('readiness projection contains no credential or provider identity', () => {
		const body = configSource.slice(configSource.indexOf('export function getExecutionReadiness'), configSource.indexOf('\nfunction isReady'));
		assert.match(body, /executionReady/);
		assert.doesNotMatch(body, /apiKey|baseUrl|model:|provider:/);
	});

	await t.test('saved provider keys remain masked/write-only in browser code', () => {
		assert.match(configSource, /apiKeyHint: config\.apiKey \? `••••\$\{config\.apiKey\.slice\(-4\)\}`/);
		assert.doesNotMatch(appSource, /localStorage\.(?:setItem|getItem)\([^\n]*api.?key/i);
		assert.doesNotMatch(appSource, /sessionStorage\.(?:setItem|getItem)\([^\n]*api.?key/i);
	});

	await t.test('human launch guard runs before mission creation', () => {
		const route = indexSource.slice(indexSource.indexOf("app.post('/api/v1/missions'"), indexSource.indexOf("app.post('/api/v1/missions/:id/start'"));
		assert.ok(route.indexOf('requireManagedExecutionReady') < route.indexOf('const mission = createMission'));
		assert.match(route, /body\.autoStart !== false/);
	});
});

test('PF-1A isolated managed-provider HTTP behavior', { timeout: 45_000 }, async t => {
	const isolated = mkdtempSync(join(root, 'artifacts', 'pf1a-provider-'));
	for (const entry of ['server', 'public', 'package.json']) cpSync(join(root, entry), join(isolated, entry), { recursive: true });
	mkdirSync(join(isolated, '.qase'));
	const password = 'PF1a-test-password-84';
	writeFileSync(join(isolated, 'fixture.mjs'), `
import { createUser, flushUsers } from './server/userStore.js';
createUser({ email: 'admin@pf1a.test', password: ${JSON.stringify(password)}, role: 'admin' });
createUser({ email: 'member@pf1a.test', password: ${JSON.stringify(password)}, role: 'operator' });
flushUsers();
await import('./server/index.js');
`);
	const port = await new Promise(resolvePort => {
		const socket = createServer();
		socket.listen(0, '127.0.0.1', () => {
			const selected = socket.address().port;
			socket.close(() => resolvePort(selected));
		});
	});
	const base = `http://127.0.0.1:${port}`;
	const child = spawn(process.execPath, ['fixture.mjs'], {
		cwd: isolated,
		env: { ...process.env, PORT: String(port), QASE_DATA_DIR: join(isolated, '.qase'), QASE_AUTH_MODE: 'required', QASE_API_TOKEN: '', QASE_API_KEY: '', ANTHROPIC_API_KEY: '' },
		stdio: ['ignore', 'pipe', 'pipe'],
		windowsHide: true
	});
	let log = '';
	child.stdout.on('data', chunk => { log += chunk; });
	child.stderr.on('data', chunk => { log += chunk; });
	t.after(async () => {
		if (child.exitCode === null) {
			child.kill();
			await once(child, 'exit').catch(() => {});
		}
		for (let attempt = 0; attempt < 10; attempt++) {
			try { rmSync(isolated, { recursive: true, force: true }); break; }
			catch { await delay(100); }
		}
	});

	async function call(path, { method = 'GET', cookie, body } = {}) {
		const response = await fetch(base + path, {
			method,
			redirect: 'manual',
			headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		});
		const text = await response.text();
		let json;
		try { json = JSON.parse(text); } catch { json = text; }
		return { status: response.status, json, cookie: response.headers.get('set-cookie')?.split(';')[0] };
	}

	for (let attempt = 0; attempt < 120; attempt++) {
		if (child.exitCode !== null) throw new Error(log);
		try { if ((await call('/api/health')).status === 200) break; } catch { /* booting */ }
		await delay(100);
	}
	assert.equal((await call('/api/health')).status, 200, log);
	const admin = (await call('/api/auth/login', { method: 'POST', body: { email: 'admin@pf1a.test', password } })).cookie;
	const member = (await call('/api/auth/login', { method: 'POST', body: { email: 'member@pf1a.test', password } })).cookie;
	assert.ok(admin && member);

	await t.test('unconfigured workspace returns a truthful generic readiness state', async () => {
		const result = await call('/api/config', { cookie: member });
		assert.equal(result.status, 200);
		assert.equal(result.json.executionReady, false);
		assert.equal(result.json.executionSetupRequired, true);
		assert.match(result.json.executionStatusMessage, /not configured.*administrator/i);
		for (const field of ['provider', 'providers', 'baseUrl', 'model', 'hasApiKey', 'apiKeyHint', 'problem', 'ready']) assert.equal(field in result.json, false, field);
	});

	await t.test('unconfigured human auto-start is rejected before a mission is created', async () => {
		const before = await call('/api/v1/missions?limit=100', { cookie: member });
		const sessionsBefore = await call('/api/sessions', { cookie: member });
		const schedulesBefore = await call('/api/schedules', { cookie: member });
		const blocked = await call('/api/v1/missions', { method: 'POST', cookie: member, body: { targetUrl: `${base}/demo`, type: 'full_audit', autoStart: true } });
		const after = await call('/api/v1/missions?limit=100', { cookie: member });
		const sessionsAfter = await call('/api/sessions', { cookie: member });
		const schedulesAfter = await call('/api/schedules', { cookie: member });
		assert.equal(blocked.status, 503);
		assert.equal(blocked.json.code, 'execution_setup_required');
		assert.equal(blocked.json.executionReady, false);
		assert.equal(after.json.total, before.json.total);
		assert.equal(sessionsAfter.json.length, sessionsBefore.json.length);
		assert.equal(schedulesAfter.json.length, schedulesBefore.json.length);
	});

	await t.test('draft creation remains possible but explicit human start is blocked', async () => {
		const draft = await call('/api/v1/missions', { method: 'POST', cookie: member, body: { targetUrl: `${base}/demo`, type: 'full_audit', autoStart: false } });
		assert.equal(draft.status, 201);
		const start = await call(`/api/v1/missions/${draft.json.missionId}/start`, { method: 'POST', cookie: member, body: {} });
		assert.equal(start.status, 503);
		assert.equal(start.json.code, 'execution_setup_required');
	});

	await t.test('regular user cannot enter the advanced provider configuration path', async () => {
		const denied = await call('/api/config', {
			method: 'PUT', cookie: member,
			body: { provider: 'custom', apiKey: 'unauthorized-test-value', baseUrl: `${base}/not-allowed`, model: 'not-allowed' }
		});
		assert.equal(denied.status, 403);
	});

	await t.test('administrator can configure the existing managed-provider path', async () => {
		const saved = await call('/api/config', {
			method: 'PUT', cookie: admin,
			body: { provider: 'custom', apiKey: 'pf1a-managed-secret-value', baseUrl: `${base}/managed-provider`, model: 'pf1a-test-model' }
		});
		assert.equal(saved.status, 200);
		assert.equal(saved.json.executionReady, true);
		assert.equal(saved.json.hasApiKey, true);
		assert.notEqual(saved.json.apiKeyHint, 'pf1a-managed-secret-value');
		assert.doesNotMatch(JSON.stringify(saved.json), /pf1a-managed-secret-value/);
	});

	await t.test('regular user sees managed execution ready without provider details', async () => {
		const result = await call('/api/config', { cookie: member });
		assert.equal(result.status, 200);
		assert.equal(result.json.executionReady, true);
		assert.equal(result.json.executionSetupRequired, false);
		for (const field of ['provider', 'providers', 'baseUrl', 'model', 'hasApiKey', 'apiKeyHint']) assert.equal(field in result.json, false, field);
		assert.doesNotMatch(JSON.stringify(result.json), /pf1a-managed-secret-value|managed-provider|pf1a-test-model/);
	});

	await t.test('regular user can start with the server-managed provider and no personal key', async () => {
		const started = await call('/api/v1/missions', {
			method: 'POST', cookie: member,
			body: { targetUrl: `${base}/demo`, type: 'full_audit', autoStart: true }
		});
		assert.equal(started.status, 202);
		assert.ok(started.json.missionId);
		assert.equal('apiKey' in started.json, false);
		await call(`/api/v1/missions/${started.json.missionId}/stop`, { method: 'POST', cookie: member, body: {} });
	});

	await t.test('signup still creates a normal internal operator, then login restores it', async () => {
		const email = `new-${Date.now()}@pf1a.test`;
		const injection = await call('/api/auth/signup', { method: 'POST', body: { email, password, confirmPassword: password, role: 'admin' } });
		assert.equal(injection.status, 400);
		const signup = await call('/api/auth/signup', { method: 'POST', body: { email, password, confirmPassword: password } });
		assert.equal(signup.status, 201);
		assert.equal(signup.json.user.role, 'operator');
		const login = await call('/api/auth/login', { method: 'POST', body: { email, password } });
		assert.equal(login.status, 200);
		const me = await call('/api/auth/me', { cookie: login.cookie });
		assert.equal(me.status, 200);
		assert.equal(me.json.role, 'operator');
	});
});
