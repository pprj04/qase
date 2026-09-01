/**
 * QASE external-handoff readiness test — black-box, HTTP only.
 * Steps: OpenAPI discovery → HMAC auth (+ negatives) → golden read flow (v2)
 * → schema validation → negative testing. No QASE source imports, no .qase reads.
 *
 * Credentials come from env (never printed):
 *   HANDOFF_BASE_URL    default https://pulse-review-workspa-6grhjr.drytis.dev
 *   HANDOFF_HMAC_KEY_ID default ext-handoff-test   (provisioned principal)
 *   HANDOFF_HMAC_SECRET shared integration secret
 *   HANDOFF_BEARER_TOKEN instance API token (for the /api/v2 read surface)
 */
import { createHmacClient } from './hmac-client.mjs';
import { createValidator } from './schema-validate.mjs';
import { randomBytes } from 'node:crypto';

const BASE = process.env.HANDOFF_BASE_URL || 'https://pulse-review-workspa-6grhjr.drytis.dev';
const KEY_ID = process.env.HANDOFF_HMAC_KEY_ID || 'ext-handoff-test';
const SECRET = process.env.HANDOFF_HMAC_SECRET || process.env.QASE_INTEGRATION_SECRET;
const BEARER = process.env.HANDOFF_BEARER_TOKEN || process.env.QASE_API_TOKEN;

const results = [];
const t = (id, name, pass, detail) => {
	results.push({ id, name, pass, detail });
	console.log(`${pass ? 'PASS' : 'FAIL'}  [${id}] ${name}${detail ? ` — ${detail}` : ''}`);
};
const isJson = (headers) => (headers.get('content-type') || '').includes('application/json');

// ---------- STEP 1: OpenAPI discovery ----------
let spec = null;
{
	const res = await fetch(`${BASE}/openapi.json`);
	const openapiUrl = `${BASE}/openapi.json`;
	const bodyText = await res.text();
	const loads = res.status === 200 && (() => { try { spec = JSON.parse(bodyText); return true; } catch { return false; } })();
	t('openapi.1', 'OpenAPI loads and parses', loads, `${openapiUrl} → HTTP ${res.status}`);
	t('openapi.2', 'OpenAPI version declared', !!spec?.openapi?.startsWith('3.'), spec?.openapi);
	const schemes = Object.keys(spec?.components?.securitySchemes ?? {});
	t('openapi.3', 'Authentication scheme documented', schemes.length > 0, `securitySchemes: ${schemes.join(', ')}`);
	const paths = Object.entries(spec?.paths ?? {});
	const withParams = paths.filter(([, ops]) => Object.values(ops).some((op) => (op.parameters ?? []).length > 0)).length;
	t('openapi.4', 'Request parameters documented', withParams >= paths.length * 0.7, `${withParams}/${paths.length} paths carry parameter docs`);
	const withSchemas = paths.filter(([, ops]) => Object.values(ops).some((op) => Object.keys(op.responses ?? {}).some((c) => c.startsWith('2') && op.responses[c]?.content?.['application/json']?.schema))).length;
	t('openapi.5', 'Response schemas documented (2xx success)', withSchemas === paths.length, `${withSchemas}/${paths.length} paths declare a 2xx JSON schema`);
	const withErrors = paths.filter(([, ops]) => Object.values(ops).some((op) => Object.keys(op.responses ?? {}).some((c) => c.startsWith('4') || c.startsWith('5')))).length;
	t('openapi.6', 'Error responses documented', withErrors >= paths.length - 1, `${withErrors}/${paths.length} paths document 4xx/5xx`);
}

const v = createValidator(spec);
const hmac = createHmacClient({ baseUrl: BASE, keyId: KEY_ID, secret: SECRET });

// ---------- STEP 1b: integration surface discoverable in the LIVE spec ----------
{
	const intPaths = Object.entries(spec.paths ?? {}).filter(([p]) => p.startsWith('/api/v1/integration/'));
	const opCount = intPaths.reduce((n, [, m]) => n + Object.keys(m).length, 0);
	t('intspec.1', 'Live OpenAPI includes the integration surface (15 ops)', opCount === 15, `${intPaths.length} paths / ${opCount} ops`);
	const scheme = spec.components?.securitySchemes?.hmacAuth;
	const desc = scheme?.description ?? '';
	t('intspec.2', 'hmacAuth scheme documents signing format', scheme?.type === 'apiKey' && desc.includes('QASE-HMAC-SHA256') && desc.includes('canonical'), `type=${scheme?.type}, format + canonical documented: ${desc.includes('QASE-HMAC-SHA256') && desc.includes('canonical')}`);
	const codesOk = ['unknown_key', 'bad_signature', 'stale_signature', 'replayed_nonce', 'invalid_auth_header', 'not_configured'].every((c) => desc.includes(c));
	t('intspec.3', 'hmacAuth scheme documents the 401 error codes', codesOk, codesOk ? 'all six 401 codes present' : 'missing some codes');
	const secOk = intPaths.every(([, m]) => Object.values(m).every((op) => JSON.stringify(op.security ?? []).includes('hmacAuth')));
	t('intspec.4', 'Every integration op carries hmacAuth security', secOk, secOk ? 'yes' : 'some ops missing security');
	const expected = {
		'get /api/v1/integration/whoami': '200', 'post /api/v1/integration/keys': '201', 'get /api/v1/integration/keys': '200',
		'post /api/v1/integration/missions': '202', 'get /api/v1/integration/missions/{id}': '200',
		'get /api/v1/integration/missions/{id}/report': '200', 'get /api/v1/integration/missions/{id}/decision-trace': '200',
		'get /api/v1/integration/missions/{id}/findings': '200', 'get /api/v1/integration/missions/{id}/evidence': '200',
		'post /api/v1/integration/missions/{id}/stop': '200', 'post /api/v1/integration/missions/{id}/start': '202',
		'post /api/v1/integration/webhooks': '201', 'post /api/v1/integration/missions/{id}/revalidate': '202',
		'post /api/v1/integration/findings/{id}/revalidate': '202', 'get /api/v1/integration/findings/{id}/validation': '200',
	};
	const mismatch = [];
	for (const [key, want] of Object.entries(expected)) {
		const [m, p] = key.split(' ');
		const codes = Object.keys(spec.paths[p]?.[m]?.responses ?? {}).filter((c) => c.startsWith('2') || c === '409');
		if (!codes.includes(want)) mismatch.push(`${key} wants ${want}, has ${codes.join(',') || 'none'}`);
	}
	t('intspec.5', 'Integration success codes match the documented contract (201/202/200 + 409s)', mismatch.length === 0, mismatch.length ? mismatch.slice(0, 3).join('; ') : 'all 15 match');
}

// ---------- STEP 2: Authentication (HMAC integration credential) ----------
{
	const r = await hmac.whoami();
	t('auth.1', 'Valid integration credential → 200', r.status === 200, `HTTP ${r.status}`);
	const bodyOk = r.status === 200 && typeof r.json?.keyId === 'string' && typeof r.json?.principal === 'string' && Array.isArray(r.json?.scopes) && typeof r.json?.workspaceId === 'string';
	t('auth.2', 'whoami returns key identity + scopes + workspace', bodyOk, `keyId=${r.json?.keyId} principal=${r.json?.principal} workspaceId=${r.json?.workspaceId} scopes=${(r.json?.scopes ?? []).length}`);

	const badSecret = createHmacClient({ baseUrl: BASE, keyId: KEY_ID, secret: 'definitely-wrong-secret-0123456789' });
	const r2 = await badSecret.whoami();
	t('auth.3', 'Invalid credential (bad signature) → 401', r2.status === 401, `HTTP ${r2.status} code=${r2.json?.error?.code}`);

	const unknownKey = createHmacClient({ baseUrl: BASE, keyId: 'no-such-key-xyz', secret: SECRET });
	const r3 = await unknownKey.whoami();
	t('auth.4', 'Unknown keyId → 401', r3.status === 401, `HTTP ${r3.status} code=${r3.json?.error?.code}`);

	// Insufficient permission: a non-admin integration principal calling the admin-only key-registration op
	const r4 = await hmac.request('POST', '/api/v1/integration/keys', { body: { keyId: 'should-not-exist', workspaceId: 'wsX', label: 'nope' } });
	t('auth.5', 'Insufficient permission (integration principal → admin op) → 403', r4.status === 403, `HTTP ${r4.status} code=${r4.json?.error?.code}`);

	// Anti-replay: reuse the exact same (ts, nonce, signature) on a second request
	const fixed = { timestampMs: Date.now(), nonce: randomBytes(8).toString('hex') };
	const ra = await hmac.request('GET', '/api/v1/integration/whoami', { signOverrides: fixed });
	const rb = await hmac.request('GET', '/api/v1/integration/whoami', { signOverrides: fixed });
	t('auth.6', 'Replayed signature rejected', ra.status === 200 && rb.status === 401, `first=${ra.status} replay=${rb.status} code=${rb.json?.error?.code}`);

	const rNoAuth = await fetch(`${BASE}/api/v1/integration/whoami`);
	t('auth.7', 'No auth on integration surface → 401', rNoAuth.status === 401, `HTTP ${rNoAuth.status}`);
}

// ---------- STEP 4: Golden API flow (v2 read surface, bearer) ----------
let projectId = null;
{
	const r = await fetch(`${BASE}/api/v2/usage/summary`, { headers: { Authorization: `Bearer ${BEARER}` } });
	const json = await r.json().catch(() => null);
	t('flow.1', 'GET /api/v2/usage/summary (usage endpoint)', r.status === 200 && isJson(r.headers), `HTTP ${r.status} content-type=${r.headers.get('content-type')}`);
	if (json) {
		const { validated, errors } = v.validate(json, '/api/v2/usage/summary');
		t('flow.2', 'usage/summary matches OpenAPI schema', validated && errors.length === 0, errors.length ? errors.slice(0, 3).join('; ') : `window=${JSON.stringify(json.window)} totals keys=${Object.keys(json.totals ?? {}).length} buckets=${(json.buckets ?? []).length}`);
	}

	const rp = await fetch(`${BASE}/api/v2/projects`, { headers: { Authorization: `Bearer ${BEARER}` } });
	const projects = await rp.json().catch(() => null);
	t('flow.3', 'GET /api/v2/projects (project list)', rp.status === 200 && isJson(rp.headers), `HTTP ${rp.status} count=${Array.isArray(projects) ? projects.length : 'not-array'}`);
	if (Array.isArray(projects) && projects.length > 0) {
		const { errors } = v.validate(projects, '/api/v2/projects');
		projectId = projects[0].id;
		t('flow.4', 'projects[] match Project schema', errors.length === 0, errors.length ? errors.slice(0, 3).join('; ') : `first=${projects[0].name} (${typeof projects[0].id === 'string' || typeof projects[0].id === 'number' ? 'valid id type' : 'BAD id type'})`);
	} else {
		t('flow.4', 'projects[] match Project schema', false, 'no projects returned to validate');
	}

	if (projectId !== null) {
		const rs = await fetch(`${BASE}/api/v2/findings/stats?project_id=${encodeURIComponent(projectId)}`, { headers: { Authorization: `Bearer ${BEARER}` } });
		const stats = await rs.json().catch(() => null);
		t('flow.5', 'GET /api/v2/findings/stats?project_id=<real> (project-specific)', rs.status === 200 && Number.isInteger(stats?.total), `HTTP ${rs.status} total=${stats?.total}`);
		const { errors } = v.validate(stats, '/api/v2/findings/stats');
		t('flow.6', 'findings/stats matches schema', errors.length === 0, errors.length ? errors.slice(0, 3).join('; ') : 'schema ok');
	}

	// timeseries: usage/summary with explicit bucket + regression/trend
	const rt = await fetch(`${BASE}/api/v2/regression/trend?limit=5`, { headers: { Authorization: `Bearer ${BEARER}` } });
	const trend = await rt.json().catch(() => null);
	t('flow.7', 'GET /api/v2/regression/trend?limit=5 (timeseries)', rt.status === 200 && isJson(rt.headers), `HTTP ${rt.status} points=${Array.isArray(trend?.trend ?? trend?.points ?? trend) ? 'yes' : JSON.stringify(trend).slice(0, 60)}`);
}

// ---------- STEP 5: deep response validation (pagination + timestamps) ----------
{
	const r1 = await fetch(`${BASE}/api/v2/metrics/api-usage?page=1&page_size=2`, { headers: { Authorization: `Bearer ${BEARER}` } });
	const p1 = await r1.json().catch(() => null);
	const shapeOk = r1.status === 200 && p1 && typeof p1.total === 'number' && p1.page === 1 && p1.page_size === 2 && Array.isArray(p1.data) && p1.data.length <= 2;
	t('resp.1', 'Pagination fields work (page/page_size echo, data ≤ page_size)', shapeOk, `HTTP ${r1.status} total=${p1?.total} page=${p1?.page} page_size=${p1?.page_size} data=${p1?.data?.length}`);
	const r2 = await fetch(`${BASE}/api/v2/metrics/api-usage?page=2&page_size=2`, { headers: { Authorization: `Bearer ${BEARER}` } });
	const p2 = await r2.json().catch(() => null);
	const noOverlap = p1 && p2 && (p2.data.length === 0 || JSON.stringify(p1.data[0] ?? {}) !== JSON.stringify(p2.data[0] ?? {}));
	t('resp.2', 'Page 2 differs from page 1 (real pagination)', r2.status === 200 && noOverlap, `page2 data=${p2?.data?.length}`);

	const rm = await fetch(`${BASE}/api/v2/missions?limit=3`, { headers: { Authorization: `Bearer ${BEARER}` } });
	const missions = await rm.json().catch(() => null);
	const arr = Array.isArray(missions) ? missions : missions?.missions ?? missions?.data ?? [];
	const tsOk = arr.every((m) => typeof m.created_at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(m.created_at)) || arr.length === 0;
	t('resp.3', 'Timestamps are ISO-8601 strings', rm.status === 200 && tsOk, `${arr.length} missions checked, sample created_at=${arr[0]?.created_at ?? 'n/a'}`);
	const idOk = arr.every((m) => (typeof m.id === 'string' && m.id.length >= 4) || typeof m.id === 'number');
	t('resp.4', 'IDs are valid (string ≥4 chars or number)', rm.status === 200 && idOk, `sample id=${arr[0]?.id ?? 'n/a'}`);

	// Content-Type on every successful response so far was JSON; one more typed check
	t('resp.5', 'Content-Type: application/json on API responses', isJson(rm.headers), rm.headers.get('content-type'));
}

// ---------- STEP 6: Negative testing ----------
{
	const rn = await fetch(`${BASE}/api/v2/projects`);
	t('neg.1', 'Missing authentication → 401', rn.status === 401, `HTTP ${rn.status}`);
	const ri = await fetch(`${BASE}/api/v2/projects`, { headers: { Authorization: 'Bearer totally-invalid-token' } });
	t('neg.2', 'Invalid authentication → 401', ri.status === 401, `HTTP ${ri.status}`);
	const en = JSON.parse(await ri.text().catch(() => '{}'));
	t('neg.3', '401 body uses documented error envelope', !!en.error?.code || typeof en.error === 'string', JSON.stringify(en).slice(0, 80));

	const rx = await hmac.getMission('no-such-mission-000');
	t('neg.4', 'Invalid mission ID (integration surface) → 404', rx.status === 404, `HTTP ${rx.status} code=${rx.json?.error?.code}`);

	const rb = await hmac.createMission({ name: 'malformed', type: 'smoke', targetUrl: 'https://example.com', context: { maxTurns: 9999 } });
	t('neg.5', 'Malformed request (maxTurns > 500) → 400', rb.status === 400, `HTTP ${rb.status} code=${rb.json?.error?.code}`);

	const ru = await fetch(`${BASE}/api/v2/projects`, { method: 'DELETE', headers: { Authorization: `Bearer ${BEARER}` } });
	t('neg.6', 'Unsupported method (DELETE /api/v2/projects) → 4xx', ru.status >= 400 && ru.status < 500, `HTTP ${ru.status}`);

	const rp = await fetch(`${BASE}/api/v2/findings/stats?project_id=nonexistent-project-xyz`, { headers: { Authorization: `Bearer ${BEARER}` } });
	const pj = await rp.json().catch(() => null);
	t('neg.7', 'Unknown project_id filter → graceful 200 + empty/zero (no 500)', rp.status === 200 && Number.isInteger(pj?.total), `HTTP ${rp.status} total=${pj?.total}`);
}

// ---------- Summary ----------
const failed = results.filter((r) => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
process.exit(failed.length === 0 ? 0 : 1);
