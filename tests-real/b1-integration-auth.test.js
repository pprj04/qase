/**
 * B1 W1/W2/W4 — Integration auth, workspace authorization, idempotency,
 * correlation. Live HTTP tests against the running server (same pattern as
 * phase5-api.test.js). Requires QASE_INTEGRATION_SECRET in .env.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';

const BASE = process.env.QASE_TEST_BASE_URL || `http://localhost:${process.env.PORT || 5173}`;
const SECRET = process.env.QASE_INTEGRATION_SECRET || '';

function sign(keyId, method, path, body = '') {
	const ts = String(Date.now());
	const nonce = randomBytes(8).toString('hex');
	const bodyHash = createHmac('sha256', '').update(body).digest('hex');
	const sig = createHmac('sha256', SECRET).update(`${method}\n${path}\n${ts}\n${nonce}\n${bodyHash}`).digest('hex');
	return `QASE-HMAC-SHA256 ${keyId}:${ts}:${nonce}:${sig}`;
}

async function icall(keyId, method, path, bodyObj, extraHeaders = {}, opts = {}) {
	const body = bodyObj === undefined ? '' : JSON.stringify(bodyObj);
	const headers = {
		...(body ? { 'Content-Type': 'application/json' } : {}),
		...(opts.skipAuth ? {} : { Authorization: sign(keyId, method, path, body) }),
		...extraHeaders
	};
	const res = await fetch(BASE + path, { method, headers, body: body || undefined });
	const text = await res.text();
	let json = null; try { json = JSON.parse(text); } catch { /* ok */ }
	return { status: res.status, json, headers: res.headers };
}

let wsAMissionId = null;

describe('B1 W1 — integration auth boundary', () => {
	it('anonymous request → 401 with stable envelope', async () => {
		const r = await icall('x', 'GET', '/api/v1/integration/whoami', undefined, {}, { skipAuth: true });
		assert.equal(r.status, 401);
		assert.equal(r.json.error.code, 'invalid_auth_header');
	});
	it('unknown keyId → 401 unknown_key', async () => {
		const r = await icall('definitely-not-a-key', 'GET', '/api/v1/integration/whoami');
		assert.equal(r.status, 401);
		assert.equal(r.json.error.code, 'unknown_key');
	});
	it('tampered signature → 401 bad_signature', async () => {
		const ts = String(Date.now());
		const nonce = randomBytes(8).toString('hex');
		const hdr = `QASE-HMAC-SHA256 qase-admin:${ts}:${nonce}:${'0'.repeat(64)}`;
		const res = await fetch(`${BASE}/api/v1/integration/whoami`, { headers: { Authorization: hdr } });
		assert.equal(res.status, 401);
		const j = await res.json();
		assert.equal(j.error.code, 'bad_signature');
	});
	it('stale timestamp (10 min old) → 401 stale_signature', async () => {
		const ts = String(Date.now() - 10 * 60 * 1000);
		const nonce = randomBytes(8).toString('hex');
		const bodyHash = createHmac('sha256', '').update('').digest('hex');
		const sig = createHmac('sha256', SECRET).update(`GET\n/api/v1/integration/whoami\n${ts}\n${nonce}\n${bodyHash}`).digest('hex');
		const res = await fetch(`${BASE}/api/v1/integration/whoami`, {
			headers: { Authorization: `QASE-HMAC-SHA256 qase-admin:${ts}:${nonce}:${sig}` }
		});
		assert.equal(res.status, 401);
		assert.equal((await res.json()).error.code, 'stale_signature');
	});
	it('admin whoami → 200 with principal+scopes', async () => {
		const r = await icall('qase-admin', 'GET', '/api/v1/integration/whoami');
		assert.equal(r.status, 200);
		assert.equal(r.json.principal, 'admin');
		assert.deepEqual(r.json.scopes, ['*']);
	});
	it('nonce replay → 401 replayed_nonce', async () => {
		const auth = sign('qase-admin', 'GET', '/api/v1/integration/whoami');
		const r1 = await fetch(`${BASE}/api/v1/integration/whoami`, { headers: { Authorization: auth } });
		assert.equal(r1.status, 200);
		const r2 = await fetch(`${BASE}/api/v1/integration/whoami`, { headers: { Authorization: auth } });
		assert.equal(r2.status, 401);
		assert.equal((await r2.json()).error.code, 'replayed_nonce');
	});
	it('signature is path-bound (GET sig reused on other path) → 401', async () => {
		const auth = sign('qase-admin', 'GET', '/api/v1/integration/whoami');
		const r = await fetch(`${BASE}/api/v1/integration/keys`, { headers: { Authorization: auth } });
		assert.equal(r.status, 401);
	});
	it('integration principal cannot register keys (403 admin_required)', async () => {
		const r = await icall('b1-test-int', 'POST', '/api/v1/integration/keys', { keyId: 'b1-test-int', workspaceId: 'b1-ws' });
		// unknown key first — register via admin below; here expect 401 unknown_key OR 403
		if (r.status === 401) {
			// register it first
			const reg = await icall('qase-admin', 'POST', '/api/v1/integration/keys',
				{ keyId: 'b1-test-int', workspaceId: 'b1-ws' });
			assert.equal(reg.status, 201);
			const r2 = await icall('b1-test-int', 'POST', '/api/v1/integration/keys',
				{ keyId: 'b1-test-int-2', workspaceId: 'b1-ws' });
			assert.equal(r2.status, 403);
			assert.equal(r2.json.error.code, 'admin_required');
		} else {
			assert.equal(r.status, 403);
		}
	});
});

describe('B1 W2 — workspace authorization matrix', () => {
	before(async () => {
		await icall('qase-admin', 'POST', '/api/v1/integration/keys', { keyId: 'b1-wsA', workspaceId: 'ws-A' });
		await icall('qase-admin', 'POST', '/api/v1/integration/keys', { keyId: 'b1-wsB', workspaceId: 'ws-B' });
	});
	it('A creates mission → 201; A→A reads 200', async () => {
		const r = await icall('b1-wsA', 'POST', '/api/v1/integration/missions',
			{ targetUrl: 'https://new.drytis.com', name: 'B1 matrix A', type: 'ux', autoStart: false });
		assert.equal(r.status, 201);
		wsAMissionId = r.json.missionId;
		const g = await icall('b1-wsA', 'GET', `/api/v1/integration/missions/${wsAMissionId}`);
		assert.equal(g.status, 200);
	});
	it('A→A findings 200; B→A findings 403 workspace_forbidden', async () => {
		const a = await icall('b1-wsA', 'GET', `/api/v1/integration/missions/${wsAMissionId}/findings`);
		assert.equal(a.status, 200);
		const b = await icall('b1-wsB', 'GET', `/api/v1/integration/missions/${wsAMissionId}/findings`);
		assert.equal(b.status, 403);
		assert.equal(b.json.error.code, 'workspace_forbidden');
	});
	it('B→A evidence/report/status 403; admin→A 200', async () => {
		const paths = ['/evidence', '/report', ''];
		for (const p of paths) {
			const b = await icall('b1-wsB', 'GET', `/api/v1/integration/missions/${wsAMissionId}${p}`);
			assert.equal(b.status, 403, `path ${p}`);
		}
		const adm = await icall('qase-admin', 'GET', `/api/v1/integration/missions/${wsAMissionId}`);
		assert.equal(adm.status, 200);
	});
	it('missing mission → 404 mission_not_found for BOTH workspaces (no existence leak)', async () => {
		const fake = 'aaaaaaaa-0000-0000-0000-000000000000';
		const a = await icall('b1-wsA', 'GET', `/api/v1/integration/missions/${fake}`);
		const b = await icall('b1-wsB', 'GET', `/api/v1/integration/missions/${fake}`);
		assert.equal(a.status, 404);
		assert.equal(b.status, 404);
		assert.equal(a.json.error.code, 'mission_not_found');
	});
	it('B cannot stop A\u2019s mission (403 before any state change)', async () => {
		const b = await icall('b1-wsB', 'POST', `/api/v1/integration/missions/${wsAMissionId}/stop`, {});
		assert.equal(b.status, 403);
	});
});

describe('B1 W4 — idempotency + correlation', () => {
	it('same workspace + same Idempotency-Key → same mission, idempotentReplay=true', async () => {
		const body = { targetUrl: 'https://new.drytis.com', name: 'B1 idem', type: 'ux', autoStart: false };
		const k = { 'Idempotency-Key': `b1-idem-${Date.now()}` };
		const r1 = await icall('b1-wsA', 'POST', '/api/v1/integration/missions', body, k);
		assert.equal(r1.status, 201);
		const r2 = await icall('b1-wsA', 'POST', '/api/v1/integration/missions', body, k);
		assert.equal(r2.status, 200);
		assert.equal(r2.json.idempotentReplay, true);
		assert.equal(r2.json.missionId, r1.json.missionId);
	});
	it('different workspace, same key → INDEPENDENT missions (workspace-scoped keys)', async () => {
		const body = { targetUrl: 'https://new.drytis.com', name: 'B1 idem B', type: 'ux', autoStart: false };
		const k = { 'Idempotency-Key': `b1-idem-shared-${Date.now()}` };
		const r1 = await icall('b1-wsA', 'POST', '/api/v1/integration/missions', body, k);
		const r2 = await icall('b1-wsB', 'POST', '/api/v1/integration/missions', body, k);
		assert.equal(r1.status, 201);
		assert.equal(r2.status, 201);
		assert.notEqual(r1.json.missionId, r2.json.missionId);
	});
	it('caller-supplied X-Correlation-Id echoes on response and lands on the mission', async () => {
		const cid = `b1cid-${randomBytes(4).toString('hex')}`;
		const r = await icall('b1-wsA', 'POST', '/api/v1/integration/missions',
			{ targetUrl: 'https://new.drytis.com', name: 'B1 cid', type: 'ux', autoStart: false },
			{ 'X-Correlation-Id': cid });
		assert.equal(r.status, 201);
		assert.equal(r.headers.get('x-correlation-id'), cid);
		const g = await icall('b1-wsA', 'GET', `/api/v1/integration/missions/${r.json.missionId}`);
		assert.equal(g.json.correlationId, cid);
	});
	it('server generates a correlation id when absent', async () => {
		const r = await icall('b1-wsA', 'GET', '/api/v1/integration/whoami');
		const cid = r.headers.get('x-correlation-id');
		assert.ok(cid && cid.startsWith('cid_'));
	});
	it('malformed correlation id is replaced, not echoed', async () => {
		const r = await icall('b1-wsA', 'GET', '/api/v1/integration/whoami', undefined,
			{ 'X-Correlation-Id': '### invalid $$ spaces and very long text that goes beyond any reasonable bound '.repeat(4) });
		const cid = r.headers.get('x-correlation-id');
		assert.ok(cid && cid.startsWith('cid_'), 'generated, not echoed');
	});
});

describe('B1 W6 — maxTurns contract at the API layer', () => {
	it('context.maxTurns=8 is stored on the mission context', async () => {
		const r = await icall('b1-wsA', 'POST', '/api/v1/integration/missions',
			{ targetUrl: 'https://new.drytis.com', name: 'B1 turns', type: 'ux', autoStart: false, context: { maxTurns: 8 } });
		assert.equal(r.status, 201);
		const g = await icall('b1-wsA', 'GET', `/api/v1/integration/missions/${r.json.missionId}`);
		assert.equal(g.json.maxTurns, 8);
	});
	it('maxTurns 0 / 501 / "abc" → 400 invalid_max_turns', async () => {
		for (const bad of [0, 501, 'abc']) {
			const r = await icall('b1-wsA', 'POST', '/api/v1/integration/missions',
				{ targetUrl: 'https://new.drytis.com', type: 'ux', autoStart: false, context: { maxTurns: bad } });
			assert.equal(r.status, 400, `maxTurns=${JSON.stringify(bad)}`);
			assert.equal(r.json.error.code, 'invalid_max_turns');
		}
	});
});
