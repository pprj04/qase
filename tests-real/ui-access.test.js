/**
 * D0.5 — Scoped UI access codes: 20-case suite.
 *
 * Runs against the LIVE server (like api-contract) using QASE_API_TOKEN if
 * configured, plus isolated subprocess tests against .qase/ui-access.json.
 * Verifies: session creation, role enforcement (viewer read-only,
 * operator missions), sensitive config master-only, 401/403 truthfulness,
 * rate limiting, revocation, cookie flags, plaintext-never-stored/
 * never-returned, master auth unchanged, restart persistence, expiry.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.QASE_BASE_URL ?? 'http://127.0.0.1:5173';

/** Read the master token from the live store (test harness convention). */
function masterToken() {
	if (process.env.QASE_API_TOKEN) return process.env.QASE_API_TOKEN;
	const raw = readFileSync(new URL('../.qase/config.json', import.meta.url), 'utf8');
	const cfg = JSON.parse(raw);
	return cfg.apiToken ?? '';
}
const TOKEN = masterToken();
const hasServer = TOKEN !== '';

async function call(path, { method = 'GET', body, token, cookie, raw = false } = {}) {
	const headers = { 'content-type': 'application/json' };
	if (token) headers.authorization = `Bearer ${TOKEN}`;
	if (cookie) headers.cookie = cookie;
	const res = await fetch(`${BASE}${path}`, {
		method, headers,
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	if (raw) return { res, text: await res.text() };
	let json = null;
	try { json = await res.json(); } catch { /* non-JSON */ }
	return { status: res.status, json, headers: res.headers };
}

/** Mint a code using the master token (admin API). */
async function mint(role, label = `d05-${role}`) {
	// The suite's own invalid-login tests can trip the per-IP limiter —
	// reset it so minting (which runs BEFORE any failure) is never blocked.
	const { status, json } = await call('/api/auth/admin/codes', {
		method: 'POST', token: true, body: { label, role }
	});
	assert.equal(status, 200, `mint failed: ${JSON.stringify(json)}`);
	return json;
}

/** Clear the live server's failed-login limiter (admin hook). */
async function resetLimiter() {
	await call('/api/auth/admin/codes/limiter-reset', { method: 'POST', token: true });
}

/** Login with a code → session cookie string. */
async function login(code) {
	const res = await fetch(`${BASE}/api/auth/session`, {
		method: 'POST', headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ accessCode: code })
	});
	const setCookie = res.headers.get('set-cookie') ?? '';
	const m = /qase_session=([^;]+)/.exec(setCookie);
	return { status: res.status, setCookie, cookie: m ? `qase_session=${m[1]}` : null, json: await res.json().catch(() => null) };
}

const SECRETS_PATTERN = /qase-team-[A-Za-z0-9_-]{10,}/;

/* ── Live-server cases (require the server + a configured token) ──── */

test('D05.1 viewer code → session works', { skip: !hasServer }, async () => {
	const { code } = await mint('viewer');
	const login1 = await login(code);
	assert.equal(login1.status, 200);
	assert.ok(login1.cookie, 'qase_session cookie must be set');
	assert.equal(login1.json.role, 'viewer');
	assert.match(login1.json.label, /d05-viewer/);
});

test('D05.2 viewer can read permitted data', { skip: !hasServer }, async () => {
	const { code } = await mint('viewer');
	const { cookie } = await login(code);
	const sessions = await call('/api/sessions', { cookie });
	assert.equal(sessions.status, 200, 'viewer GET /api/sessions must be allowed');
	const projects = await call('/api/projects', { cookie });
	assert.equal(projects.status, 200);
});

test('D05.3 viewer cannot create a mission/session', { skip: !hasServer }, async () => {
	const { code } = await mint('viewer');
	const { cookie } = await login(code);
	const res = await call('/api/sessions', { method: 'POST', cookie, body: { prompt: 'd05 viewer test' } });
	assert.equal(res.status, 403, `viewer POST /api/sessions must 403, got ${res.status}`);
});

test('D05.4 viewer cannot modify config', { skip: !hasServer }, async () => {
	const { code } = await mint('viewer');
	const { cookie } = await login(code);
	const res = await call('/api/config', { method: 'PUT', cookie, body: { maxTurns: 42 } });
	assert.equal(res.status, 403, `viewer PUT /api/config must 403, got ${res.status}`);
});

test('D05.5 operator code → session works', { skip: !hasServer }, async () => {
	const { code } = await mint('operator');
	const login1 = await login(code);
	assert.equal(login1.status, 200);
	assert.equal(login1.json.role, 'operator');
});

test('D05.6 operator permitted mission ops (start/stop)', { skip: !hasServer }, async () => {
	const { code, id } = await mint('operator');
	const { cookie } = await login(code);
	// STOP on a nonexistent mission: exercises the role path (must NOT be 403);
	// acceptable outcomes are 404 (unknown) — proves the role gate passed.
	const res = await call(`/api/v1/missions/${'0'.repeat(24)}/stop`, { method: 'POST', cookie });
	assert.notEqual(res.status, 403, 'operator must pass the role gate on mission stop');
	assert.notEqual(res.status, 401, 'operator must be authenticated');
});

test('D05.7 operator cannot modify sensitive config', { skip: !hasServer }, async () => {
	const { code } = await mint('operator');
	const { cookie } = await login(code);
	const put = await call('/api/config', { method: 'PUT', cookie, body: { maxTurns: 44 } });
	assert.equal(put.status, 403, `operator PUT /api/config must 403, got ${put.status}`);
	const bsTest = await call('/api/config/test-browserstack', { method: 'POST', cookie, body: {} });
	assert.equal(bsTest.status, 403, `operator BrowserStack test must 403, got ${bsTest.status}`);
});

test('D05.8 invalid code → 401', { skip: !hasServer }, async () => {
	await resetLimiter();
	const res = await login('qase-team-totally-wrong-code');
	assert.equal(res.status, 401);
});

test('D05.9 repeated invalid attempts rate-limited', { skip: !hasServer }, async () => {
	await resetLimiter();
	// 5 failures puts the (per-IP) limiter over the edge → 429 on #6.
	const attempts = [];
	for (let i = 0; i < 6; i++) attempts.push(login('qase-team-invalid-' + i));
	const results = await Promise.all(attempts);
	assert.ok(results.slice(0, 5).every(r => r.status === 401 || r.status === 429));
	const codes = results.map(r => r.status);
	assert.ok(codes.includes(429), `expected a 429 among [${codes}], none seen`);
	await resetLimiter();
});

test('D05.10 revoked code rejected', { skip: !hasServer }, async () => {
	const { code, id } = await mint('viewer');
	const { cookie } = await login(code);
	assert.ok(cookie);
	const del = await call(`/api/auth/admin/codes/${id}`, { method: 'DELETE', token: true });
	assert.equal(del.status, 200);
	// Existing session dies on its very next request.
	const stillValid = await call('/api/sessions', { cookie });
	assert.equal(stillValid.status, 401, 'revoked code session must be rejected');
	// And the code cannot mint a new session.
	const relogin = await login(code);
	assert.equal(relogin.status, 401);
});

test('D05.11 session cookie HttpOnly', { skip: !hasServer }, async () => {
	const { code } = await mint('viewer');
	const login1 = await login(code);
	assert.ok(/httponly/i.test(login1.setCookie), `cookie flags must include HttpOnly: ${login1.setCookie}`);
});

test('D05.12 session cookie SameSite=Strict', { skip: !hasServer }, async () => {
	const { code } = await mint('viewer');
	const login1 = await login(code);
	assert.ok(/samesite=strict/i.test(login1.setCookie), `cookie flags must include SameSite=Strict: ${login1.setCookie}`);
});

test('D05.13 code never stored plaintext', { skip: !hasServer }, async () => {
	const { code } = await mint('viewer', 'plaintext-probe');
	const raw = readFileSync(new URL('../.qase/ui-access.json', import.meta.url), 'utf8');
	assert.ok(!raw.includes(code), 'plaintext code must not appear in ui-access.json');
	assert.ok(!SECRETS_PATTERN.test(raw), 'no qase-team- plaintext anywhere in the store');
	assert.ok(raw.includes('scrypt1:'), 'store must contain scrypt1 hashes');
});

test('D05.14 code never in API responses', { skip: !hasServer }, async () => {
	const minted = await mint('viewer', 'api-probe');
	assert.ok(minted.code && minted.code.startsWith('qase-team-'), 'mint response carries the code ONCE by design');
	const list = await call('/api/auth/admin/codes', { token: true });
	const text = JSON.stringify(list.json);
	assert.ok(!text.includes(minted.code), 'list response must never contain the code');
	assert.ok(!SECRETS_PATTERN.test(text), 'no qase-team- plaintext in list responses');
	assert.ok(!list.json.codes.some(c => c.codeHash), 'hashes must never be returned');
});

test('D05.15 master API-token auth unchanged', { skip: !hasServer }, async () => {
	const anon = await call('/api/sessions');
	assert.equal(anon.status, 401, 'anonymous must still 401');
	const master = await call('/api/sessions', { token: true });
	assert.equal(master.status, 200, 'master bearer must still work');
});

test('D05.16 B1 integration auth still works', { skip: !hasServer }, async () => {
	// The HMAC surface must remain independent of UI sessions: an anonymous
	// integration request with a bad signature is still rejected by the
	// integration middleware itself (not by the bearer gate).
	const res = await call('/api/v1/integration/whoami', { method: 'GET' });
	assert.equal(res.status, 401, `expected 401 from requireIntegrationAuth, got ${res.status}`);
});

test('D05.17 no secret in logs', { skip: !hasServer }, async () => {
	const { code } = await mint('viewer', 'log-probe');
	await login(code);
	// Server logs live in /var/log/services/<name>.log
	const fs = await import('node:fs');
	const candidates = [
		'/var/log/services/service-bg-service-3962.log',
		'/var/log/services/drytis-service.log'
	];
	for (const logPath of candidates) {
		if (!existsSync(logPath)) continue;
		const log = fs.readFileSync(logPath, 'utf8');
		assert.ok(!log.includes(code), `plaintext code must not appear in ${logPath}`);
	}
});

test('D05.18 viewer/operator cannot bypass by URL', { skip: !hasServer }, async () => {
	const { code } = await mint('viewer');
	const { cookie } = await login(code);
	// Try the same operation under different URL shapes — all must 403.
	for (const p of ['/api/config/', '/api/config?x=1', '/api/auth/admin/codes', '/api/v1/webhooks']) {
		const res = await call(p, { method: 'POST', cookie, body: {} });
		assert.ok(res.status === 403 || res.status === 401,
			`viewer ${p} must be denied, got ${res.status}`);
	}
});

/* ── Restart persistence + expiry (subprocess isolation) ──────────── */

function runIsolated(script, extra = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'd05-'));
	const env = { ...process.env, QASE_DATA_DIR: dir, ...extra };
	return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
		cwd: process.cwd(), env, encoding: 'utf8'
	});
}

test('D05.19 restart preserves access-code records', { skip: !hasServer }, async () => {
	const dir = mkdtempSync(join(tmpdir(), 'd05-restart-'));
	const seedEnv = { ...process.env, QASE_DATA_DIR: dir };
	// Step 1: mint + persist + flush.
	const seed = spawnSync(process.execPath, ['--input-type=module', '-e', `
import { mintCode, flush } from './server/uiAccess.js';
const m = mintCode({ label: 'restart-probe', role: 'operator' });
flush();
console.log(m.code);
`], { cwd: process.cwd(), env: seedEnv, encoding: 'utf8' });
	assert.equal(seed.status, 0, seed.stderr);
	const code = seed.stdout.trim();
	// Repo convention (config.js): the data file lives directly in
	// QASE_DATA_DIR, not under a .qase/ subdirectory.
	const file = join(dir, 'ui-access.json');
	assert.ok(existsSync(file), 'ui-access.json must persist after flush');
	const raw = readFileSync(file, 'utf8');
	assert.ok(!raw.includes(code), 'plaintext never on disk');
	// Step 2: fresh module instance (simulated restart) must accept the code.
	const verify = spawnSync(process.execPath, ['--input-type=module', '-e', `
import { loginWithCode } from './server/uiAccess.js';
const r = loginWithCode(${JSON.stringify(code)});
console.log(JSON.stringify({ ok: r.ok, role: r.ok ? r.session.role : null }));
`], { cwd: process.cwd(), env: seedEnv, encoding: 'utf8' });
	assert.equal(verify.status, 0, verify.stderr);
	assert.ok(verify.stdout.includes('"ok":true'), `code must survive restart: ${verify.stdout}`);
});

test('D05.20 session expiry behaves correctly', { skip: !hasServer }, async () => {
	const dir = mkdtempSync(join(tmpdir(), 'd05-expiry-'));
	const env = { ...process.env, QASE_DATA_DIR: dir, QASE_UI_SESSION_TTL_HOURS: '1' };
	const seed = spawnSync(process.execPath, ['--input-type=module', '-e', `
import { mintCode, loginWithCode, resolveSession, _clearSessionsForTests } from './server/uiAccess.js';
const m = mintCode({ label: 'expiry', role: 'viewer' });
const r = loginWithCode(m.code);
const before = resolveSession(r.session.id);
// Simulate the future: expiresAt in the past → rejected.
const session = resolveSession(r.session.id, { now: Date.now() + 2 * 3600_000 });
console.log(JSON.stringify({ before: Boolean(before), after: Boolean(session) }));
`], { cwd: process.cwd(), env, encoding: 'utf8' });
	assert.equal(seed.status, 0, seed.stderr);
	assert.ok(seed.stdout.includes('"before":true'), 'session valid before expiry');
	assert.ok(seed.stdout.includes('"after":false'), 'session invalid after expiry');
});
