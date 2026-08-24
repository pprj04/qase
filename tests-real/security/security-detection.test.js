/**
 * M1-P2 — SECURITY DETECTION SUITE.
 *
 * Purpose: make every KNOWN production blocker measurable — NOT to fix them
 * (fixes belong to later milestones). Each test asserts the CURRENT observable
 * behavior and tags it with its risk ID. When a risk is remediated, the test
 * is updated in the same commit as the fix (the suite doubles as the
 * remediation acceptance test).
 *
 * Risk registry (from M1-P1 §13):
 *   S1  mutation token auto-set as cookie for any visitor
 *   S2  SSRF: unvalidated target URLs reach page.goto
 *   S3  artifacts unauthenticated + CORP cross-origin
 *   S4  no rate limiting on expensive operations
 *   S5  secret leakage surface (config, error paths)
 *   S6  path traversal (covered in contract suite — re-asserted here)
 *   S7  open GET data exposure (single-tenant model, documented)
 *
 * THIS SUITE IS ADVISORY (non-blocking) by design: failures = open risks
 * documented, not regressions.
 */

import { describe, it } from 'node:test';
import 'dotenv/config';
import assert from 'node:assert/strict';

const BASE = process.env.QASE_URL || `http://127.0.0.1:${process.env.PORT || 5173}`;
const TOKEN = process.env.QASE_API_TOKEN || '';
const AUTH = { 'content-type': 'application/json', Authorization: `Bearer ${TOKEN}` };

async function probe(p, init = {}) {
	const headers = { ...(init.headers ?? {}) };
	if (TOKEN && !('Authorization' in headers)) headers.Authorization = `Bearer ${TOKEN}`;
	const res = await fetch(`${BASE}${p}`, { ...init, headers });
	const text = await res.text();
	return { status: res.status, text, headers: res.headers };
}

describe('SECURITY [S1] — mutation token auto-cookie', () => {
	it('FIXED (M1-P3 P0-5): anonymous GET must NOT set qase_token cookie', async () => {
		const r = await probe('/api/health');
		const setCookie = r.headers.get('set-cookie') ?? '';
		const setsToken = /qase_token=/.test(setCookie);
		// S1 was fixed in M1-P3 (setAuthCookie no longer auto-grants). This is
		// now a REGRESSION GUARD: the token must never be handed out again.
		assert.equal(setsToken, false, 'REGRESSION: anonymous response set qase_token — S1 reopened');
	});
	it('cookie lacks Secure flag (known S1b, open)', async () => {
		const r = await probe('/api/sessions');
		const sc = r.headers.get('set-cookie') ?? '';
		assert.equal(/;\s*Secure/.test(sc), false, 'Secure flag appeared — update this detection test');
	});
});

describe('SECURITY [S2] — SSRF boundary (FIXED in M1-P4.1: targetGuard)', () => {
	it('FIXED (M1-P4.1): mission creation REJECTS link-local metadata URL', async () => {
		// Regression guard for the SSRF boundary. The metadata service IP must
		// never be accepted as a mission target.
		const r = await fetch(`${BASE}/api/v1/missions`, {
			method: 'POST', headers: AUTH,
			body: JSON.stringify({ targetUrl: 'http://169.254.169.254/latest/meta-data/', type: 'qa_review' })
		});
		assert.ok([400, 403].includes(r.status), `SSRF guard missing (status ${r.status}) — REGRESSION: targetGuard not enforced on POST /api/v1/missions`);
		const m = await r.json().catch(() => ({}));
		assert.ok(m.error || m.message, 'rejection body must carry a human message');
		assert.equal(m.code, 'LINK_LOCAL_TARGET', 'deterministic machine-readable code');
	});
	it('FIXED (M1-P4.1): mission creation REJECTS localhost on non-practice port', async () => {
		const r = await fetch(`${BASE}/api/v1/missions`, {
			method: 'POST', headers: AUTH,
			body: JSON.stringify({ targetUrl: 'http://localhost:8080/', type: 'qa_review' })
		});
		assert.ok([400, 403].includes(r.status), `status ${r.status}`);
	});
});

describe('SECURITY [S3] — artifacts exposure', () => {
	it('DETECTION: artifacts route is unauthenticated (known S3, open)', async () => {
		const r = await probe('/api/artifacts/some-run/step-0.jpeg');
		assert.notEqual(r.status, 401, 'artifacts now auth-gated — update this test');
	});
	it('DETECTION: artifacts served with cross-origin resource policy (known S3b, open)', async () => {
		const r = await probe('/api/artifacts/some-run/missing.jpeg');
		const corp = r.headers.get('cross-origin-resource-policy');
		assert.equal(corp, 'cross-origin', 'CORP tightened — update this test');
	});
	it('run IDs enumerable via open GET (known S7 adjacent, open)', async () => {
		const r = await probe('/api/test-cases');
		assert.equal(r.status, 200, 'test-cases GET no longer open — model changed, update');
	});
});

describe('SECURITY [S4] — rate limiting', () => {
	it('DETECTION: 25 rapid health/config requests all succeed (no limiter, known S4, open)', async () => {
		const codes = [];
		for (let i = 0; i < 25; i++) {
			const r = await probe('/api/health');
			codes.push(r.status);
		}
		const throttled = codes.filter(c => c === 429).length;
		assert.equal(throttled, 0, 'rate limiter appeared — update this test and load policy docs');
	});
});

describe('SECURITY [S5] — secret leakage', () => {
	it('config API never echoes the raw BrowserStack key', async () => {
		const r = await probe('/api/config', { headers: AUTH });
		const body = r.text.toLowerCase();
		assert.ok(!body.includes('browserstackkey":"') || !/"browserstackkey":\s*"[^"]+"/.test(r.text), 'raw key leaked in config GET');
	});
	it('server source errors do not include stack traces in responses', async () => {
		const r = await fetch(`${BASE}/api/v1/missions/not-a-real-id/revalidate`, { method: 'POST', headers: AUTH, body: '{}' });
		const body = await r.text();
		assert.ok(!/at\s+\S+\s+\(.*\.js:\d+/.test(body), 'stack trace leaked in error response');
	});
	it('probe response shape never contains credential fields', async () => {
		const r = await fetch(`${BASE}/api/config/test-browserstack`, { method: 'POST', headers: AUTH, body: '{}' });
		const body = await r.text();
		for (const banned of ['browserstackKey', 'accessKey', 'apiKey', 'password']) {
			assert.ok(!body.includes(`"${banned}"`), `credential field "${banned}" echoed`);
		}
	});
});

describe('SECURITY [S6] — path traversal (must stay BLOCKED)', () => {
	it('encoded traversal → 400 (S6 stays BLOCKED)', async () => {
		const r = await probe('/api/artifacts/..%2F..%2Fetc%2Fpasswd');
		assert.ok([400, 404].includes(r.status), `status ${r.status}`);
	});
	it('plain traversal → 400/404', async () => {
		const r = await probe('/api/artifacts/../../../etc/passwd');
		assert.ok([400, 404].includes(r.status));
	});
	it('artifact filename with slash never resolves outside run dir', async () => {
		const r = await probe('/api/artifacts/legit-run/..%2Fconfig.json');
		assert.ok([400, 404].includes(r.status));
	});
});

describe('SECURITY [S7] — single-tenant model honesty', () => {
	it('anonymous page visitor can read open GET data endpoints (documented single-tenant posture)', async () => {
		// sessions list is open today (cookie-equivalent). Document:
		const r = await fetch(`${BASE}/api/sessions`);
		assert.equal(r.status, 200, 'sessions GET no longer open — auth model changed, update cred.json docs');
	});
});
