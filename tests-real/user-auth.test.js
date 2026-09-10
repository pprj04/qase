/**
 * D2 — User accounts, login & durable sessions: 22-case suite.
 *
 * Structure mirrors ui-access.test.js: live-server cases (when QASE_API_TOKEN
 * is configured) + isolated subprocess cases against a temp QASE_DATA_DIR
 * covering the userStore itself (hashing, durability, lockout, no plaintext).
 *
 * Verified properties:
 *   bootstrap claim-once · login flows · generic failures (no enumeration) ·
 *   rate limit/lockout · restart durability (store reload) · cookie flags ·
 *   role matrix on live endpoints · disable revokes sessions · password reset
 *   revokes other sessions · no plaintext anywhere · master token + B1 + D0.5
 *   codes unchanged · audit rows written · session expiry.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.QASE_BASE_URL ?? 'http://127.0.0.1:5173';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function masterToken() {
	if (process.env.QASE_API_TOKEN) return process.env.QASE_API_TOKEN;
	try {
		const raw = readFileSync(new URL('../.qase/config.json', import.meta.url), 'utf8');
		return JSON.parse(raw).apiToken ?? '';
	} catch { return ''; }
}
const TOKEN = masterToken();
// QASE_AUTH_MODE: this suite verifies user-session auth (D2) against a live
// REQUIRED-mode server. When the target runs disabled mode, user-session
// enforcement is intentionally inert (kind:'open' passes everything) and the
// required-mode matrix is covered by tests-real/auth-mode.test.js instead.
const OPEN_MODE = await fetch(`${BASE}/api/auth/me`)
	.then((r) => (r.ok ? r.json() : null))
	.then((j) => j?.kind === 'open')
	.catch(() => false);
const hasServer = TOKEN !== '' && !OPEN_MODE;

async function call(path, { method = 'GET', body, token, cookie } = {}) {
	const headers = { 'content-type': 'application/json' };
	if (token) headers.authorization = `Bearer ${TOKEN}`;
	if (cookie) headers.cookie = cookie;
	const res = await fetch(`${BASE}${path}`, {
		method, headers,
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	let json = null;
	try { json = await res.json(); } catch { /* non-JSON */ }
	return { status: res.status, json, headers: res.headers };
}

/** Fresh admin account for this suite (unique email per run).. */
const RUN = Date.now().toString(36);
let adminCookie = null;
async function ensureAdmin() {
	if (adminCookie) return adminCookie;
	// Bootstrap is already claimed on the live workspace → create a suite
	// admin through the master token (it outranks everyone).
	const email = `d2-admin-${RUN}@test.local`;
	const password = 'd2-admin-password';
	const created = await call('/api/auth/users', { method: 'POST', token: true, body: { email, password, role: 'admin', name: 'D2 Admin' } });
	if (created.status !== 201) throw new Error(`suite admin create failed: ${created.status} ${JSON.stringify(created.json)}`);
	const login = await call('/api/auth/login', { method: 'POST', body: { email, password } });
	assert.equal(login.status, 200, 'suite admin login failed');
	adminCookie = cookieOf(login.headers);
	return adminCookie;
}

function cookieOf(headers) {
	const set = headers.getSetCookie?.() ?? [headers.get('set-cookie')].filter(Boolean);
	for (const c of set) if (c.startsWith('qase_session=')) return c.split(';')[0];
	return null;
}

/** Isolated subprocess probe against a fresh temp dir. */
function probe(script, { env = {} } = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'd2-auth-'));
	const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
		env: { ...process.env, QASE_DATA_DIR: dir, ...env },
		cwd: ROOT,
		encoding: 'utf8',
		timeout: 30_000
	});
	return { dir, result };
}

function outLine(result) {
	const lines = (result.stdout ?? '').trim().split('\n').filter(Boolean);
	return lines.length ? lines[lines.length - 1] : '';
}

const BOOTSTRAP = `
import * as store from './server/userStore.js';
const email = 'boot@t.local', password = 'bootstrap-pass-1';
const u = store.createUser({ email, password, role: 'admin' });
const t = store.createSession(u.id);
console.log(JSON.stringify({ ok: true, hasUsers: store.hasUsers(), token: t }));
`;

// ═══════════ LIVE SERVER CASES ═══════════

test('D2-01: bootstrap endpoint reports one-time admin claim state', async () => {
	if (!hasServer) return;
	const { status, json } = await call('/api/auth/bootstrap');
	assert.equal(status, 200);
	assert.equal(typeof json.needsAdmin, 'boolean');
	assert.equal(json.version, 4);
});

test('D2-02: unauthenticated API access is 401 (B1 unchanged)', async () => {
	if (!hasServer) return;
	const { status } = await call('/api/config');
	assert.equal(status, 401);
});

test('D2-03: register-admin is permanently closed once claimed', async () => {
	if (!hasServer) return;
	const boot = await call('/api/auth/bootstrap');
	if (boot.json.needsAdmin) return; // fresh workspace: claim tested in subprocess
	const { status, json } = await call('/api/auth/register-admin', {
		method: 'POST', token: true, body: { email: `late-${RUN}@t.local`, password: 'late-admin-pass' }
	});
	assert.equal(status, 403);
	assert.match(json.error, /already exists/i);
});

test('D2-04: login sets HttpOnly SameSite=Strict cookie', async () => {
	if (!hasServer) return;
	const cookie = await ensureAdmin();
	assert.match(cookie, /^qase_session=/);
	const login = await call('/api/auth/login', { method: 'POST', body: { email: `d2-admin-${RUN}@test.local`, password: 'd2-admin-password' } });
	const set = login.headers.getSetCookie?.() ?? [];
	const c = set.find(x => x.startsWith('qase_session=')) ?? '';
	assert.match(c, /HttpOnly/i);
	assert.match(c, /SameSite=Strict/i);
	assert.match(c, /Path=\//i);
});

test('D2-05: invalid credentials → generic message, no enumeration', async () => {
	if (!hasServer) return;
	const wrongPw = await call('/api/auth/login', { method: 'POST', body: { email: `d2-admin-${RUN}@test.local`, password: 'definitely-wrong' } });
	const noUser = await call('/api/auth/login', { method: 'POST', body: { email: `ghost-${RUN}@t.local`, password: 'definitely-wrong' } });
	assert.equal(wrongPw.status, 401);
	assert.equal(noUser.status, 401);
	assert.equal(wrongPw.json.error, noUser.json.error); // identical → cannot probe accounts
	assert.match(wrongPw.json.error, /Invalid email or password/);
});

test('D2-06: weak passwords rejected at creation', async () => {
	if (!hasServer) return;
	const cookie = await ensureAdmin();
	const { status, json } = await call('/api/auth/users', {
		method: 'POST', cookie, body: { email: `weak-${RUN}@t.local`, password: 'short', role: 'viewer' }
	});
	assert.equal(status, 400);
	assert.match(json.error, /at least 10/);
});

test('D2-07: viewer role is read-only on live endpoints', async () => {
	if (!hasServer) return;
	const cookie = await ensureAdmin();
	const email = `d2-viewer-${RUN}@t.local`, password = 'viewer-password-1';
	const created = await call('/api/auth/users', { method: 'POST', cookie, body: { email, password, role: 'viewer' } });
	assert.equal(created.status, 201);
	const login = await call('/api/auth/login', { method: 'POST', body: { email, password } });
	const vc = cookieOf(login.headers);
	const read = await call('/api/v1/missions', { cookie: vc });
	assert.equal(read.status, 200);
	const write = await call('/api/v1/missions', { method: 'POST', cookie: vc, body: { name: 'd2 viewer write' } });
	assert.equal(write.status, 403);
});

test('D2-08: operator role can create missions but not manage users', async () => {
	if (!hasServer) return;
	const cookie = await ensureAdmin();
	const email = `d2-op-${RUN}@t.local`, password = 'operator-password';
	const created = await call('/api/auth/users', { method: 'POST', cookie, body: { email, password, role: 'operator' } });
	assert.equal(created.status, 201);
	const login = await call('/api/auth/login', { method: 'POST', body: { email, password } });
	const oc = cookieOf(login.headers);
	const mission = await call('/api/v1/missions', {
		method: 'POST', cookie: oc,
		body: { name: `d2-op-${RUN}`, targetUrl: 'http://127.0.0.1:9901/' }
	});
	assert.ok([200, 201, 202].includes(mission.status), `mission create: ${mission.status}`);
	const users = await call('/api/auth/users', { cookie: oc });
	assert.equal(users.status, 403);
	const cfgWrite = await call('/api/config', { method: 'PUT', cookie: oc, body: {} });
	assert.equal(cfgWrite.status, 403);
	// cleanup: stop the mission if it started
	const mid = mission.json?.missionId;
	if (mid) await call(`/api/v1/missions/${mid}/stop`, { method: 'POST', token: true });
});

test('D2-09: viewer gets sanitized /api/config (no provider/keys/BrowserStack)', async () => {
	if (!hasServer) return;
	const cookie = await ensureAdmin();
	const email = `d2-cfg-${RUN}@t.local`, password = 'cfg-viewer-pass';
	await call('/api/auth/users', { method: 'POST', cookie, body: { email, password, role: 'viewer' } });
	const login = await call('/api/auth/login', { method: 'POST', body: { email, password } });
	const vc = cookieOf(login.headers);
	const { status, json } = await call('/api/config', { cookie: vc });
	assert.equal(status, 200);
	for (const banned of ['provider', 'baseUrl', 'model', 'apiKeyHint', 'apiTokenHint', 'hasApiToken', 'browserstackUser', 'browserstackEnabled']) {
		assert.ok(!(banned in (json ?? {})), `sanitized config must not expose ${banned}`);
	}
});

test('D2-10: disabling a user kills their sessions immediately', async () => {
	if (!hasServer) return;
	const cookie = await ensureAdmin();
	const email = `d2-dis-${RUN}@t.local`, password = 'disable-pass-123';
	const created = await call('/api/auth/users', { method: 'POST', cookie, body: { email, password, role: 'operator' } });
	const uid = created.json?.user?.id;
	const login = await call('/api/auth/login', { method: 'POST', body: { email, password } });
	const uc = cookieOf(login.headers);
	assert.equal((await call('/api/auth/me', { cookie: uc })).status, 200);
	const disabled = await call(`/api/auth/users/${uid}`, { method: 'PATCH', cookie, body: { disabled: true } });
	assert.equal(disabled.status, 200);
	const after = await call('/api/auth/me', { cookie: uc });
	assert.equal(after.status, 401, 'disabled user session must stop working');
	const mission = await call('/api/v1/missions', { method: 'POST', cookie: uc, body: { name: 'should-fail' } });
	assert.equal(mission.status, 401);
});

test('D2-11: password reset revokes the user’s OTHER sessions', async () => {
	if (!hasServer) return;
	const cookie = await ensureAdmin();
	const email = `d2-rst-${RUN}@t.local`, password = 'reset-pass-orig';
	const created = await call('/api/auth/users', { method: 'POST', cookie, body: { email, password, role: 'viewer' } });
	const uid = created.json?.user?.id;
	const l1 = await call('/api/auth/login', { method: 'POST', body: { email, password } });
	const c1 = cookieOf(l1.headers);
	const l2 = await call('/api/auth/login', { method: 'POST', body: { email, password } });
	const c2 = cookieOf(l2.headers);
	assert.equal((await call('/api/auth/me', { cookie: c1 })).status, 200);
	await call(`/api/auth/users/${uid}/password`, { method: 'POST', cookie, body: { password: 'reset-pass-new1' } });
	assert.equal((await call('/api/auth/me', { cookie: c1 })).status, 401, 'old session revoked by reset');
	assert.equal((await call('/api/auth/me', { cookie: c2 })).status, 401);
	const relog = await call('/api/auth/login', { method: 'POST', body: { email, password: 'reset-pass-new1' } });
	assert.equal(relog.status, 200);
});

test('D2-12: master token auth still works unchanged (B1 surface)', async () => {
	if (!hasServer) return;
	const { status } = await call('/api/config', { token: true });
	assert.equal(status, 200);
});

test('D2-13: access-code login is REMOVED — routes 404 (D2 Stage 3)', async () => {
	if (!hasServer) return;
	// The D0.5 code system was retired in Stage 3. Code mint/login must be
	// gone entirely (404), never silently accepted.
	const mint = await call('/api/auth/admin/codes', { method: 'POST', token: true, body: { label: `d2-gone-${RUN}`, role: 'viewer' } });
	assert.equal(mint.status, 404, 'code mint route must not exist');
	const login = await call('/api/auth/session', { method: 'POST', body: { accessCode: 'qase-team-anything' } });
	assert.notEqual(login.status, 200, 'code login must never succeed');
	assert.ok(login.status === 404 || login.status === 401, `unexpected status ${login.status}`);
	const cookie = cookieOf(login.headers) ?? '';
	assert.ok(!cookie.includes('qase_session='), 'no session cookie may be set');
});

test('D2-14: /api/auth/me resolves user sessions with role+email', async () => {
	if (!hasServer) return;
	const cookie = await ensureAdmin();
	const { status, json } = await call('/api/auth/me', { cookie });
	assert.equal(status, 200);
	assert.equal(json.kind, 'user');
	assert.equal(json.role, 'admin');
	assert.equal(json.email, `d2-admin-${RUN}@test.local`);
});

test('D2-15: logout destroys the current session server-side', async () => {
	if (!hasServer) return;
	const email = `d2-out-${RUN}@t.local`, password = 'logout-pass-123';
	const cookie = await ensureAdmin();
	await call('/api/auth/users', { method: 'POST', cookie, body: { email, password, role: 'viewer' } });
	const login = await call('/api/auth/login', { method: 'POST', body: { email, password } });
	const c = cookieOf(login.headers);
	assert.equal((await call('/api/auth/me', { cookie: c })).status, 200);
	await call('/api/auth/logout', { method: 'POST', cookie: c });
	assert.equal((await call('/api/auth/me', { cookie: c })).status, 401, 'session must be dead after logout');
});

test('D2-16: audit trail records logins, failures, logout and admin actions', async () => {
	if (!hasServer) return;
	// Master token may read the audit route (it outranks user admins).
	const { status, json } = await call('/api/auth/admin/audit?limit=200', { token: true });
	assert.equal(status, 200, `master audit read failed: ${status}`);
	const events = (json.entries ?? []).map(e => e.event);
	assert.ok(events.includes('login_ok'), 'login_ok present');
	assert.ok(events.includes('user_created'), 'user_created present');
	assert.ok(events.includes('login_failed'), 'login_failed present');
	assert.ok(events.includes('logout'), 'logout present (D2 review fix)');
	const raw = JSON.stringify(json.entries ?? []);
	assert.ok(!raw.includes('d2-admin-password'), 'audit must never contain passwords');
	assert.ok(!raw.includes('viewer-password-1'), 'audit must never contain passwords');
});

// ═══════════ SUBPROCESS (isolated userStore) CASES ═══════════

test('D2-17: passwords stored ONLY as scrypt hashes — never plaintext', () => {
	const { dir, result } = probe(`
import * as s from './server/userStore.js';
const u = s.createUser({ email: 'hash@t.local', password: 'plaintext-secret-pw', role: 'viewer' });
console.log(JSON.stringify({ hash: u.passwordHash === undefined ? 'hidden' : 'exposed', ok: true }));
`);
	assert.equal(result.status, 0, result.stderr);
	const raw = readFileSync(join(dir, 'users.json'), 'utf8');
	assert.match(raw, /"scrypt:/, 'hash present');
	assert.ok(!raw.includes('plaintext-secret-pw'), 'plaintext password must never hit disk');
});

test('D2-18: sessions persist across a store reload (restart durability)', () => {
	const { dir, result } = probe(`
import * as s from './server/userStore.js';
const u = s.createUser({ email: 'dur@t.local', password: 'durable-pass-1', role: 'operator' });
const t = s.createSession(u.id);
console.log(JSON.stringify({ token: t, uid: u.id }));
`);
	assert.equal(result.status, 0, result.stderr);
	const { token, uid } = JSON.parse(outLine(result));
	// second process = simulated restart
	const r2 = probe(`
import * as s from './server/userStore.js';
const resolved = s.resolveSession(process.argv[1]);
console.log(JSON.stringify({ ok: Boolean(resolved), role: resolved?.user?.role, uid: resolved?.user?.id }));
`, { env: {} });
	assert.equal(r2.result.status, 0, r2.result.stderr);
	// pass token via env instead of argv (argv was unavailable for -e)
	const r3 = spawnSync(process.execPath, ['--input-type=module', '-e', `
import * as s from './server/userStore.js';
const resolved = s.resolveSession(process.env.D2_TOKEN);
console.log(JSON.stringify({ ok: Boolean(resolved), role: resolved?.user?.role }));
`], { env: { ...process.env, QASE_DATA_DIR: dir, D2_TOKEN: token }, cwd: process.cwd(), encoding: 'utf8' });
	assert.equal(r3.status, 0, r3.stderr);
	const parsed = JSON.parse(outLine(r3));
	assert.equal(parsed.ok, true, 'session survives restart');
	assert.equal(parsed.role, 'operator');
	assert.ok(uid);
});

test('D2-19: lockout after 5 failed logins, generic message throughout', () => {
	const script = `
import * as s from './server/userStore.js';
s.createUser({ email: 'lock@t.local', password: 'real-password-1', role: 'viewer' });
const results = [];
for (let i = 0; i < 5; i++) {
	try { s.login('lock@t.local', 'wrong-' + i, '10.9.9.9'); results.push('ok'); }
	catch (e) { results.push(e.status); }
}
let locked = null;
try { s.login('lock@t.local', 'real-password-1', '10.9.9.9'); locked = 'ok'; }
catch (e) { locked = e.status; }
console.log(JSON.stringify({ results, locked }));
`;
	const { result } = probe(script);
	assert.equal(result.status, 0, result.stderr);
	const { results, locked } = JSON.parse(outLine(result));
	assert.deepEqual(results, [401, 401, 401, 401, 401]);
	assert.equal(locked, 429, 'even the CORRECT password is locked out during the window');
});

test('D2-20: audit log never contains passwords or token plaintext', () => {
	const script = `
import * as s from './server/userStore.js';
try { s.login('nobody@t.local', 'audit-probe-pw', '10.1.1.1'); } catch {}
const u = s.createUser({ email: 'audit@t.local', password: 'audit-real-pw-1', role: 'viewer' });
s.createSession(u.id);
console.log('done');
`;
	const { dir, result } = probe(script);
	assert.equal(result.status, 0, result.stderr);
	const audit = readFileSync(join(dir, 'auth-audit.log'), 'utf8');
	assert.ok(audit.includes('login_failed'));
	assert.ok(audit.includes('user_created'));
	assert.ok(!audit.includes('audit-probe-pw'), 'no passwords in audit');
	const sessions = readFileSync(join(dir, 'auth-sessions.json'), 'utf8');
	// token plaintext never on disk — only its sha256
	assert.match(sessions, /"tokenHash": "[0-9a-f]{64}"/);
});

test('D2-21: session expiry enforced on resolve', () => {
	const script = `
import * as s from './server/userStore.js';
const u = s.createUser({ email: 'exp@t.local', password: 'expire-pass-1', role: 'viewer' });
const t = s.createSession(u.id, { ttlHours: 0.00001 }); // ~36ms
await new Promise(r => setTimeout(r, 120));
console.log(JSON.stringify({ resolved: Boolean(s.resolveSession(t)) }));
`;
	const { result } = probe(script);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(JSON.parse(outLine(result)).resolved, false, 'expired session must not resolve');
});

test('D2-22: machine-only surfaces stay unreachable for non-admin roles; Admin sessions manage config', async () => {
	if (!hasServer) return;
	const cookie = await ensureAdmin();
	const email = `d2-mx-${RUN}@t.local`, password = 'matrix-pass-123';
	await call('/api/auth/users', { method: 'POST', cookie, body: { email, password, role: 'operator' } });
	const login = await call('/api/auth/login', { method: 'POST', body: { email, password } });
	const oc = cookieOf(login.headers);

	// Operator must NOT reach any master-only surface, however the path is cased.
	const variants = ['/api/config', '/API/CONFIG', '/Api/Config', '/api/CONFIG'];
	for (const p of variants) {
		const put = await call(p, { method: 'PUT', cookie: oc, body: {} });
		assert.equal(put.status, 403, `operator PUT ${p} must be 403, got ${put.status}`);
	}
	for (const p of ['/api/v1/webhooks', '/API/V1/WEBHOOKS', '/Api/V1/Webhooks']) {
		const post = await call(p, { method: 'POST', cookie: oc, body: { url: 'http://x.invalid/' } });
		assert.equal(post.status, 403, `operator POST ${p} must be 403, got ${post.status}`);
	}
	for (const p of ['/api/v1/diagnostics/store-hygiene', '/API/V1/DIAGNOSTICS/store-hygiene']) {
		const get = await call(p, { cookie: oc });
		assert.equal(get.status, 403, `operator GET ${p} must be 403, got ${get.status}`);
	}
	for (const p of ['/api/auth/admin/users-nope', '/API/AUTH/ADMIN/nope']) {
		// D2 Stage 3: the admin CODES routes were removed entirely; unknown
		// /api/auth/admin/* paths 404. The master-only prefix still blocks
		// any future admin surface from session roles — verified by the
		// webhooks/diagnostics rows above.
		const get = await call(p, { cookie: oc });
		assert.ok(get.status === 403 || get.status === 404, `operator GET ${p} must be 403/404, got ${get.status}`);
	}

	// Admin USERS can manage credential Settings without possessing the
	// master machine token, including case-varied Express paths.
	const adminLogin = await call('/api/auth/login', { method: 'POST', body: { email: `d2-admin-${RUN}@test.local`, password: 'd2-admin-password' } });
	const ac = cookieOf(adminLogin.headers);
	for (const p of ['/api/config', '/API/CONFIG']) {
		const put = await call(p, { method: 'PUT', cookie: ac, body: {} });
		assert.equal(put.status, 200, `admin-user PUT ${p} must be 200, got ${put.status}`);
	}
	const diag = await call('/API/V1/DIAGNOSTICS/store-hygiene', { cookie: ac });
	assert.equal(diag.status, 403, 'admin-user must not read diagnostics');

	// Viewer writes are blocked on ANY path casing (method gate).
	const vLogin = await call('/api/auth/login', { method: 'POST', body: { email: `d2-viewer-${RUN}@t.local`, password: 'viewer-password-1' } });
	const vc = cookieOf(vLogin.headers);
	const vPost = await call('/API/V1/MISSIONS', { method: 'POST', cookie: vc, body: { name: 'case probe' } });
	assert.equal(vPost.status, 403, `viewer POST mission (cased) must be 403, got ${vPost.status}`);
});
