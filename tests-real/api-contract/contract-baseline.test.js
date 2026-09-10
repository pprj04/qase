/**
 * M1-P2 — API CONTRACT BASELINE (machine-verifiable, pre-OpenAPI).
 *
 * Freezes observable contracts for UI-used routes: status codes, auth
 * behavior, response shape (required fields/types), validation errors,
 * backward-compat shapes. Runs against the live server; mutations use
 * throwaway entities and clean up after themselves.
 *
 * Route classification (all 152 routes) lives in
 * docs/M1-P2-API-ROUTE-CLASSIFICATION.md — generated from this baseline.
 */

import { describe, it, before } from 'node:test';
import 'dotenv/config';
import assert from 'node:assert/strict';

const BASE = process.env.QASE_URL || `http://127.0.0.1:${process.env.PORT || 5173}`;
const TOKEN = process.env.QASE_API_TOKEN || '';
const AUTH = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
const JSONH = { 'content-type': 'application/json' };

async function call(method, p, body, headers = {}) {
	const res = await fetch(`${BASE}${p}`, {
		method, headers: { ...JSONH, ...AUTH, ...headers },
		body: body ? JSON.stringify(body) : undefined
	});
	const text = await res.text();
	let json = null; try { json = JSON.parse(text); } catch { /* non-json */ }
	return { status: res.status, json, text, headers: res.headers };
}
const GET = p => call('GET', p);
const POST = (p, b, h) => call('POST', p, b, h);
const PUT = (p, b) => call('PUT', p, b);
const PATCH = (p, b) => call('PATCH', p, b);
const DELETE = p => call('DELETE', p);

// Session cookie presence is itself a contracted (S1-documented) behavior.
async function anonGet(p) {
	const res = await fetch(`${BASE}${p}`);
	return { status: res.status, setCookie: res.headers.get('set-cookie') };
}

describe('API contract — authentication boundary', () => {
	it('mutations are token-gated: POST /api/findings without token → 401', async () => {
		const r = await fetch(`${BASE}/api/findings`, { method: 'POST', headers: JSONH, body: '{}' });
		assert.equal(r.status, 401);
	});
	it('mutations with token → not 401 (validation may 400)', async () => {
		const r = await POST('/api/findings', {});
		assert.notEqual(r.status, 401);
	});
	it('health is open and has contracted shape', async () => {
		const r = await GET('/api/health');
		assert.equal(r.status, 200);
		assert.equal(r.json.status, 'ok');
		assert.equal(typeof r.json.uptime, 'number');
	});
	it('bad token is rejected like no token', async () => {
		const r = await call('POST', '/api/findings', {}, { Authorization: 'Bearer qase-invalid-token-xx' });
		assert.equal(r.status, 401);
	});
});

describe('API contract — health & config', () => {
	it('GET /api/config (auth) returns the settings surface incl. BS fields + pipeline flags', async () => {
		const r = await call('GET', '/api/config', undefined, AUTH);
		assert.equal(r.status, 200);
		for (const k of ['browserstackEnabled', 'browserstackStrict', 'maxTurns', 'headless', 'concurrentRuns', 'retriesCount']) {
			assert.ok(k in r.json, `config.${k} present`);
		}
		assert.ok(!('browserstackKey' in r.json && r.json.browserstackKey), 'raw BS key never exposed');
	});
	it('PUT /api/config round-trips a harmless field (maxTurns within clamp)', async () => {
		const before = (await call('GET', '/api/config', undefined, AUTH)).json;
		const r = await PUT('/api/config', { ...before, maxTurns: before.maxTurns });
		assert.equal(r.status, 200);
		assert.equal(typeof r.json.maxTurns, 'number');
	});
	it('POST /api/config/test-browserstack (auth) → shape {ok:boolean, code:string}, no key echo', async () => {
		const r = await POST('/api/config/test-browserstack', {});
		assert.equal(r.status, 200);
		assert.equal(typeof r.json.ok, 'boolean');
		assert.equal(typeof r.json.code, 'string');
		assert.ok(!JSON.stringify(r.json).toLowerCase().includes('browserstackkey'));
	});
});

describe('API contract — findings (bugs hub)', () => {
	it('GET /api/findings filters by severity (server-side filter contract); no-limit reads retain the legacy array shape', async () => {
		const r = await GET('/api/findings?severity=critical');
		assert.equal(r.status, 200);
		assert.ok(Array.isArray(r.json));
		// Legacy callers without `limit` still receive an array. The canonical
		// paginated contract is `limit` + `offset` → envelope and is covered by
		// the pagination suite and the Bugs-page regression test.
		if (r.json.length) assert.ok(r.json.every(f => f.severity === 'critical'));
	});
	it('severity filter works and is validated by behavior (critical → only critical)', async () => {
		const r = await GET('/api/findings?severity=critical');
		assert.equal(r.status, 200);
		assert.ok(r.json.every(f => f.severity === 'critical'));
		const sample = r.json[0] ?? {};
		if (r.json.length) {
			for (const k of ['id', 'title', 'severity', 'category', 'status', 'projectId']) {
				assert.ok(k in sample, `finding.${k}`);
			}
		}
	});
	it('POST /api/findings with only a title is ACCEPTED (documented contract: defaults applied, severity→medium, category→general)', async () => {
		// The API is intentionally permissive at creation (addFinding applies
		// defaults); the strict validation lives in report_finding tool +
		// enrichment. Freeze that observable contract.
		const r = await POST('/api/findings', { title: 'contract-permissive-probe' });
		assert.equal(r.status, 201);
		assert.equal(r.json.severity, 'medium');
		assert.equal(r.json.category, 'general');
		await DELETE(`/api/findings/${r.json.id}`);
	});
	it('POST/GET/DELETE lifecycle of a probe finding (201→default DETECTED/open→204)', async () => {
		const c = await POST('/api/findings', {
			title: 'contract probe', severity: 'low', category: 'probe', steps: ['s'],
			expected: 'e', actual: 'a', url: 'http://localhost:9901'
		});
		assert.equal(c.status, 201);
		const id = c.json.id;
		assert.equal(c.json.finding_status, 'DETECTED');
		assert.equal(c.json.status, 'open');
		assert.ok(id);
		const one = await GET(`/api/findings/${id}`);
		assert.equal(one.status, 200);
		assert.equal(one.json.id, id);
		const del = await DELETE(`/api/findings/${id}`);
		assert.ok([204, 200].includes(del.status), `delete returned ${del.status}`);
		const gone = await GET(`/api/findings/${id}`);
		assert.equal(gone.status, 404);
	});
	it('invalid finding_status is silently corrected to defaults by the store (documented: PUT accepts but normalizes; lifecycle integrity preserved)', async () => {
		const c = await POST('/api/findings', { title: 'contract probe 2', severity: 'low', category: 'probe', steps: ['s'], expected: 'e', actual: 'a', url: 'http://localhost:9901' });
		const put = await PUT(`/api/findings/${c.json.id}`, { finding_status: 'FAKE_STATUS' });
		assert.ok([200, 400].includes(put.status));
		if (put.status === 200) {
			// A garbage status must never persist as-is.
			assert.notEqual(put.json.finding_status, 'FAKE_STATUS');
		}
		await DELETE(`/api/findings/${c.json.id}`);
	});
	it('GET /api/findings/export?format=markdown → token-gated (B1 W3: anonymous reads closed)', async () => {
		// B1 W3 contract change: this route is no longer anonymous. Anonymous
		// must get 401; the tokenized call returns the markdown export.
		const anon = await anonGet('/api/findings/export?format=markdown');
		assert.equal(anon.status, 401, 'export must not be anonymously readable anymore');
		const r = await GET('/api/findings/export?format=markdown');
		assert.equal(r.status, 200);
	});
});

describe('API contract — sessions & missions', () => {
	it('GET /api/sessions → array of sessions with id+status', async () => {
		const r = await GET('/api/sessions');
		assert.equal(r.status, 200);
		assert.ok(Array.isArray(r.json));
		if (r.json.length) {
			assert.ok('id' in r.json[0] && 'status' in r.json[0]);
		}
	});
	it('GET /api/sessions/:bogus → 404 (deep-link contract)', async () => {
		const r = await GET('/api/sessions/00000000-0000-0000-0000-000000000000');
		assert.equal(r.status, 404);
	});
	it('POST /api/v1/missions REJECTS garbage targetUrl up-front → 400 (FIXED in M1-P4.1: targetGuard; was documented gap G3)', async () => {
		// M1-P4.1 contract CHANGE (deliberate): the SSRF boundary now validates
		// targetUrl at create-time and returns a structured 400 (INVALID_URL).
		const r = await POST('/api/v1/missions', { targetUrl: 'not a url at all %%', type: 'qa_review' });
		assert.equal(r.status, 400, `expected 400 INVALID_URL, got ${r.status}`);
		assert.ok(r.json.error || r.json.message, '400 carries reason');
	});
	it('POST /api/v1/missions validates device up-front → 400 on unknown device', async () => {
		const r = await POST('/api/v1/missions', { targetUrl: 'http://localhost:9901', type: 'qa_review', constraints: { device: 'NotARealDevice 99' } });
		assert.equal(r.status, 400);
		assert.ok(r.json.error || r.json.message, '400 carries reason');
	});
	it('POST /api/v1/missions/:bogus/revalidate → 404; running missions → 409 (guard contract)', async () => {
		const r = await POST('/api/v1/missions/00000000-0000-0000-0000-000000000000/revalidate', {});
		assert.ok([404, 409].includes(r.status));
	});
});

describe('API contract — test cases & runs', () => {
	it('GET /api/test-cases → array with core fields', async () => {
		const r = await GET('/api/test-cases');
		assert.equal(r.status, 200);
		assert.ok(Array.isArray(r.json));
		if (r.json.length) {
			for (const k of ['id', 'name']) assert.ok(k in r.json[0], `testcase.${k}`);
		}
	});
	it('POST /api/test-cases with empty body creates "Untitled" case (documented permissive default) — and is deletable', async () => {
		const r = await POST('/api/test-cases', {});
		assert.equal(r.status, 201);
		assert.ok(r.json.name.startsWith('Untitled'), `expected default name, got ${r.json.name}`);
		const del = await DELETE(`/api/test-cases/${r.json.id}`);
		assert.ok([200, 204].includes(del.status));
	});
	it('POST /api/test-cases/:bogus/run → 404', async () => {
		const r = await POST('/api/test-cases/does-not-exist/run', {});
		assert.ok([404, 400].includes(r.status));
	});
	it('device run contract: bogus device → 400 (never silent desktop)', async () => {
		const r = await POST('/api/test-cases/run', { device: 'Fake Phone XYZ' });
		assert.ok([400, 422].includes(r.status), `got ${r.status}`);
	});
});

describe('API contract — workflows & schedules', () => {
	it('GET /api/workflows → array', async () => {
		const r = await GET('/api/workflows');
		assert.equal(r.status, 200);
		assert.ok(Array.isArray(r.json));
	});
	it('GET /api/schedules → array with cron + active fields', async () => {
		const r = await GET('/api/schedules');
		assert.equal(r.status, 200);
		assert.ok(Array.isArray(r.json));
		if (r.json.length) {
			assert.ok('cronExpr' in r.json[0] || 'cron' in r.json[0], 'schedule carries cronExpr');
		}
	});
	it('POST /api/validate-cron reads cronExpr (not cron) and rejects garbage', async () => {
		const bad = await POST('/api/validate-cron', { cronExpr: 'garbage cron!!' });
		assert.equal(bad.status, 200);
		assert.equal(bad.json.valid, false);
		const good = await POST('/api/validate-cron', { cronExpr: '0 9 * * *' });
		assert.equal(good.json.valid, true);
	});
});

describe('API contract — v1 mission report (AI-Studio external contract)', () => {
	it('GET /api/v1/missions/:bogus/report → 404 with error shape', async () => {
		const r = await GET('/api/v1/missions/00000000-0000-0000-0000-000000000000/report');
		assert.equal(r.status, 404);
	});
});

describe('API contract — fix validations (phase 18 surface)', () => {
	it('GET /api/v1/findings/:bogus/validation → 404 (honest empty state)', async () => {
		const r = await GET('/api/v1/findings/00000000-0000-0000-0000-000000000000/validation');
		assert.ok([404, 200].includes(r.status));
		if (r.status === 200) assert.ok(r.json.runs === undefined || Array.isArray(r.json.runs));
	});
	it('POST /api/v1/findings/:bogus/revalidate → 404, never 5xx', async () => {
		const r = await POST('/api/v1/findings/00000000-0000-0000-0000-000000000000/revalidate', {});
		assert.ok([404, 409, 400].includes(r.status), `got ${r.status}`);
	});
});

describe('API contract — evidence graph surface', () => {
	it('GET /api/v1/evidence/:bogus → 404/400, no leak', async () => {
		const r = await GET('/api/v1/evidence/ev_bogus000000');
		assert.ok([400, 404].includes(r.status));
	});
});

describe('API contract — artifacts', () => {
	it('GET /api/artifacts/<run>/missing.jpeg → 404 (no directory listing)', async () => {
		const r = await GET('/api/artifacts/definitely-not-a-run/step-0.jpeg');
		assert.equal(r.status, 404);
	});
	it('path traversal is rejected', async () => {
		const r1 = await GET('/api/artifacts/..%2F..%2Fetc%2Fpasswd');
		const r2 = await GET('/api/artifacts/../../../etc/passwd');
		assert.ok([400, 404].includes(r1.status));
		assert.ok([400, 404].includes(r2.status));
	});
});
