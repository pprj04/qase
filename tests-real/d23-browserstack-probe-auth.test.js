/**
 * D2.3 (#7702) — admin-session access to the BrowserStack connection probe.
 *
 * Regression coverage for the EXACT-PATH exception added to enforceRole():
 * an authenticated ADMIN user session may call POST /api/config/test-browserstack
 * (a diagnostic that returns only a redacted verdict). Everything else under
 * /api/config stays master-token-only, and non-admin/unauthenticated callers
 * are still denied.
 *
 * Contract under test:
 *   1. admin user session  POST /api/config/test-browserstack → reaches the
 *      route (not 401/403; the probe itself may return a BrowserStack verdict)
 *   2. viewer user session  same route → 403
 *   3. unauthenticated      same route → 401
 *   4. master Bearer token  same route → allowed (unchanged)
 *   5. admin session        PUT /api/config → 403 master-only (unchanged)
 *   6. admin session        GET  /api/config  → sanitized read, no secrets
 *   7. no credential material in any response body this suite inspects
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = process.env.QASE_TEST_BASE ?? 'http://localhost:5173';
const ENV = (() => {
	try {
		const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
		return Object.fromEntries(raw.split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => {
			const i = l.indexOf('=');
			return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
		}));
	} catch { return {}; }
})();
const TOKEN = ENV.QASE_API_TOKEN;
const hasServer = Boolean(TOKEN);
const RUN = Date.now();

async function call(path, { method = 'GET', token, cookie, body } = {}) {
	const response = await fetch(`${BASE}${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...(cookie ? { Cookie: cookie } : {})
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
	});
	let json = null;
	try { json = await response.json(); } catch { /* non-JSON */ }
	return { status: response.status, headers: response.headers, json };
}

async function makeUser(role, password) {
	// Unique per call: node:test runs subtests concurrently.
	const email = `d23-${role}-${RUN}-${Math.random().toString(36).slice(2, 8)}@test.local`;
	const created = await call('/api/auth/users', { method: 'POST', token: TOKEN, body: { email, password, role, name: `D2.3 ${role}` } });
	assert.equal(created.status, 201, `user create failed: ${created.status} ${JSON.stringify(created.json)}`);
	return email;
}

async function login(email, password) {
	const r = await call('/api/auth/login', { method: 'POST', body: { email, password } });
	assert.equal(r.status, 200, 'login failed');
	const set = r.headers.getSetCookie?.() ?? [];
	const c = set.find(x => x.startsWith('qase_session='));
	assert.ok(c, 'session cookie missing');
	return c.split(';')[0];
}

async function withUsers(fn) {
	if (!hasServer) return;
	const pw = `d23-pass-${RUN}`;
	const adminEmail = await makeUser('admin', pw);
	const viewerEmail = await makeUser('viewer', pw);
	const adminCookie = await login(adminEmail, pw);
	const viewerCookie = await login(viewerEmail, pw);
	try {
		await fn({ adminCookie, viewerCookie, adminEmail, viewerEmail, pw });
	} finally {
		// disable throwaway users (master token outranks everything)
		for (const email of [adminEmail, viewerEmail]) {
			const users = (await call('/api/auth/users', { token: TOKEN })).json;
			const id = (users.data ?? users).find?.(u => u.email === email)?.id;
			if (id) await call(`/api/auth/users/${id}`, { method: 'PATCH', token: TOKEN, body: { disabled: true } }).catch(() => {});
		}
	}
}

test('D2.3-1: admin user session POST /api/config/test-browserstack is ALLOWED (reaches the probe)', { skip: !hasServer }, async () => {
	await withUsers(async ({ adminCookie }) => {
		const r = await call('/api/config/test-browserstack', { method: 'POST', cookie: adminCookie, body: {} });
		// 403 = auth gate still blocking (the bug). 200 = probe ran and returned
		// its (possibly failing) BrowserStack verdict — that is the contract.
		assert.notEqual(r.status, 403, 'admin session must pass the master-only gate for this exact path');
		assert.notEqual(r.status, 401, 'admin session must be authenticated');
		assert.equal(r.status, 200, `probe did not run: ${JSON.stringify(r.json)}`);
		assert.ok(r.json && ('ok' in r.json) && ('code' in r.json), 'probe verdict shape expected');
	});
});

test('D2.3-2: VIEWER user session POST /api/config/test-browserstack is DENIED', { skip: !hasServer }, async () => {
	await withUsers(async ({ viewerCookie }) => {
		const r = await call('/api/config/test-browserstack', { method: 'POST', cookie: viewerCookie, body: {} });
		assert.equal(r.status, 403, `viewer must stay denied, got ${r.status}`);
	});
});

test('D2.3-3: unauthenticated POST /api/config/test-browserstack is DENIED', { skip: !hasServer }, async () => {
	const r = await call('/api/config/test-browserstack', { method: 'POST', body: {} });
	assert.equal(r.status, 401, `anonymous must be denied, got ${r.status}`);
});

test('D2.3-4: master Bearer token POST /api/config/test-browserstack still ALLOWED', { skip: !hasServer }, async () => {
	const r = await call('/api/config/test-browserstack', { method: 'POST', token: TOKEN, body: {} });
	assert.equal(r.status, 200, `master path regressed: ${r.status}`);
});

test('D2.3-5: admin session PUT /api/config remains MASTER-ONLY (403)', { skip: !hasServer }, async () => {
	await withUsers(async ({ adminCookie }) => {
		const r = await call('/api/config', { method: 'PUT', cookie: adminCookie, body: { browserstackBrowsers: 'chrome' } });
		assert.equal(r.status, 403, 'PUT /api/config must stay master-only for admin sessions');
		assert.match(r.json?.error ?? '', /master API token/);
	});
});

test('D2.3-6: admin session GET /api/config is a sanitized read (no credential material)', { skip: !hasServer }, async () => {
	await withUsers(async ({ adminCookie }) => {
		const r = await call('/api/config', { method: 'GET', cookie: adminCookie });
		assert.equal(r.status, 200, 'sanitized GET for admin sessions must keep working');
		const body = JSON.stringify(r.json);
		// The public projection may carry redacted booleans/lengths but never values.
		assert.ok(!/browserstackKey"\s*:\s*"[^"]+/.test(body), 'raw key must never appear');
		assert.ok(!body.includes('sk-'), 'LLM key must never appear');
		assert.ok(!body.includes(TOKEN), 'master token must never appear');
	});
});

test('D2.3-7: probe response carries no credential material', { skip: !hasServer }, async () => {
	await withUsers(async ({ adminCookie }) => {
		const r = await call('/api/config/test-browserstack', { method: 'POST', cookie: adminCookie, body: {} });
		const body = JSON.stringify(r.json);
		assert.ok(!body.includes('Bearer '), 'no auth headers echoed');
		// maskedUser is first3+****+last2 by design; a raw username would leak
		assert.ok(!/"maskedUser"\s*:\s*"[^*]{4,}"/.test(body), 'username must be masked');
	});
});

test('D2.3-8: exact-path only — other POST routes under /api/config stay master-only', { skip: !hasServer }, async () => {
	await withUsers(async ({ adminCookie }) => {
		const r = await call('/api/config/test-browserstack/', { method: 'POST', cookie: adminCookie, body: {} });
		// trailing slash (different path) must NOT inherit the exception
		assert.ok([403, 404].includes(r.status), `exact-path check regressed: ${r.status}`);
		const r2 = await call('/api/config/test', { method: 'POST', cookie: adminCookie, body: {} });
		assert.equal(r2.status, 403, 'LLM probe POST must stay master-only (no exception granted)');
	});
});
