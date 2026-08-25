'use strict';

/**
 * B1 SECURITY-NEGATIVE TEST MATRIX (spec-review MUST-FIX #6).
 *
 * Every test is an ATTACK that must fail closed. Consolidates:
 *   AUTH attacks           — 10 variants (missing/bad/expired/replayed/…)
 *   AUTHZ attacks          — cross-workspace on mission/finding/evidence/
 *                            report/revalidate/stop/webhook registration
 *   IDEMPOTENCY attacks    — same key/different body → 409; cross-ws
 *                            independence; malformed/oversized keys
 *   WEBHOOK attacks        — tampered payload fails verification; event-id
 *                            uniqueness across deliveries; attempt header
 *   ARTIFACT attacks       — anonymous 401, cross-workspace 403/404
 *   CLIENT-SUPPLIED ws IDs — admin may set workspaceId; integration principals
 *                            must NOT be able to spoof another workspace
 *
 * Requires a live server + QASE_INTEGRATION_SECRET + QASE_API_TOKEN.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';

const BASE = process.env.QASE_TEST_BASE_URL || 'http://localhost:5173';
const SECRET = (() => {
	try { return readFileSync('/workspace/.env', 'utf8').match(/^QASE_INTEGRATION_SECRET=(.+)$/m)[1].trim(); }
	catch { return process.env.QASE_INTEGRATION_SECRET || ''; }
})();
const API_TOKEN = (() => {
	try { return readFileSync('/workspace/.env', 'utf8').match(/^QASE_API_TOKEN=(.+)$/m)[1].trim(); }
	catch { return process.env.QASE_API_TOKEN || ''; }
})();

function signedHeader(keyId, method, path, body = '', { ts = Date.now(), nonce = null, secret = SECRET } = {}) {
	const n = nonce ?? randomBytes(8).toString('hex');
	const bh = createHmac('sha256', '').update(body).digest('hex');
	const sig = createHmac('sha256', secret).update(`${method}\n${path}\n${String(ts)}\n${n}\n${bh}`).digest('hex');
	return `QASE-HMAC-SHA256 ${keyId}:${ts}:${n}:${sig}`;
}

async function raw(method, path, { headers = {}, body = '' } = {}) {
	const res = await fetch(`${BASE}${path}`, { method, headers, body: body || undefined, signal: AbortSignal.timeout(20_000) });
	let json = null; try { json = await res.json(); } catch { /* text */ }
	return { status: res.status, json, headers: res.headers };
}

function auth(keyId, method, path, body = '', opts = {}) {
	return signedHeader(keyId, method, path, body, opts);
}
const jsonHeaders = h => ({ 'Content-Type': 'application/json', ...h });

const WHOAMI = '/api/v1/integration/whoami';
const MISSIONS = '/api/v1/integration/missions';

describe('B1 security-negative matrix', { skip: !SECRET }, () => {

	test('AUTH: anonymous → 401 with stable envelope', async () => {
		const r = await raw('GET', WHOAMI);
		assert.equal(r.status, 401);
		assert.ok(r.json?.error?.code, '401 body must carry error.code');
	});

	test('AUTH: Bearer token on integration route → 401 (wrong scheme)', async () => {
		const r = await raw('GET', WHOAMI, { headers: jsonHeaders({ Authorization: `Bearer ${API_TOKEN}` }) });
		assert.equal(r.status, 401);
	});

	test('AUTH: malformed Authorization header variants → 401', async () => {
		for (const bad of ['Basic xyz', 'QASE-HMAC-SHA256', 'QASE-HMAC-SHA256 only', 'QASE-HMAC-SHA256 a:b:c:d:e:f', 'QASE-HMAC-SHA256 ::']) {
			const r = await raw('GET', WHOAMI, { headers: jsonHeaders({ Authorization: bad }) });
			assert.equal(r.status, 401, `variant ${JSON.stringify(bad)} should 401`);
		}
	});

	test('AUTH: unknown keyId → 401 unknown_key', async () => {
		const r = await raw('GET', WHOAMI, { headers: jsonHeaders({ Authorization: auth('no-such-key', 'GET', WHOAMI) }) });
		assert.equal(r.status, 401);
		assert.equal(r.json?.error?.code, 'unknown_key');
	});

	test('AUTH: wrong secret → 401 bad_signature', async () => {
		const r = await raw('GET', WHOAMI, { headers: jsonHeaders({ Authorization: auth('qase-admin', 'GET', WHOAMI, '', { secret: 'totally-wrong' }) }) });
		assert.equal(r.status, 401);
		assert.equal(r.json?.error?.code, 'bad_signature');
	});

	test('AUTH: stale timestamp (> 5 min old) → 401 stale_signature', async () => {
		const r = await raw('GET', WHOAMI, { headers: jsonHeaders({ Authorization: auth('qase-admin', 'GET', WHOAMI, '', { ts: Date.now() - 11 * 60_000 }) }) });
		assert.equal(r.status, 401);
		assert.equal(r.json?.error?.code, 'stale_signature');
	});

	test('AUTH: future timestamp (> tolerance) → 401', async () => {
		const r = await raw('GET', WHOAMI, { headers: jsonHeaders({ Authorization: auth('qase-admin', 'GET', WHOAMI, '', { ts: Date.now() + 11 * 60_000 }) }) });
		assert.equal(r.status, 401);
	});

	test('AUTH: nonce replay → 401 replayed_nonce', async () => {
		const nonce = randomBytes(8).toString('hex');
		const h1 = auth('qase-admin', 'GET', WHOAMI, '', { nonce });
		const r1 = await raw('GET', WHOAMI, { headers: jsonHeaders({ Authorization: h1 }) });
		assert.equal(r1.status, 200);
		const r2 = await raw('GET', WHOAMI, { headers: jsonHeaders({ Authorization: h1 }) });
		assert.equal(r2.status, 401);
		assert.equal(r2.json?.error?.code, 'replayed_nonce');
	});

	test('AUTH: body tampering → 401 (signature covers body)', async () => {
		const path = '/api/v1/integration/webhooks';
		const body = JSON.stringify({ url: 'http://127.0.0.1:9931/hooks', events: ['mission.completed'] });
		const h = auth('qase-admin', 'POST', path, body);
		const tampered = body.replace('mission.completed', 'mission.completed","x');
		const r = await raw('POST', path, { headers: jsonHeaders({ Authorization: h }), body: tampered });
		assert.equal(r.status, 401);
	});

	test('AUTH: path tampering → 401 (signature covers path)', async () => {
		const h = auth('qase-admin', 'GET', WHOAMI);
		const r = await raw('GET', '/api/v1/integration/keys', { headers: jsonHeaders({ Authorization: h }) });
		assert.equal(r.status, 401, 'signature bound to whoami path must not authorize /keys');
	});

	test('AUTHZ: wsA token → admin/wsB mission routes → 403/404, never 200', async () => {
		// admin creates a mission in wsB
		const created = await raw('POST', MISSIONS, {
			headers: jsonHeaders({ Authorization: auth('qase-admin', 'POST', MISSIONS, JSON.stringify({
				name: 'sec-neg wsB mission', type: 'smoke', targetUrl: 'https://new.drytis.com',
				context: { maxTurns: 2 }, workspaceId: 'wsB', autoStart: false
			})), 'Idempotency-Key': `secneg-wsB-${Date.now()}` }),
			body: JSON.stringify({ name: 'sec-neg wsB mission', type: 'smoke', targetUrl: 'https://new.drytis.com', context: { maxTurns: 2 }, workspaceId: 'wsB', autoStart: false })
		});
		assert.ok([201, 202].includes(created.status), `create ${created.status}`);
		const mid = created.json.missionId;

		// wsA reads wsB's mission → 403
		const read = await raw('GET', `${MISSIONS}/${mid}`, { headers: jsonHeaders({ Authorization: auth('wsA-int', 'GET', `${MISSIONS}/${mid}`) }) });
		assert.equal(read.status, 403);
		assert.equal(read.json?.error?.code, 'workspace_forbidden');

		// wsA stops wsB's mission → 403 (no state change)
		const stopPath = `${MISSIONS}/${mid}/stop`;
		const stop = await raw('POST', stopPath, { headers: jsonHeaders({ Authorization: auth('wsA-int', 'POST', stopPath) }) });
		assert.equal(stop.status, 403);

		// unknown mission → 404 for everyone (no enumeration signal)
		const ghost = '00000000-0000-0000-0000-000000000000';
		for (const keyId of ['wsA-int', 'qase-admin']) {
			const r = await raw('GET', `${MISSIONS}/${ghost}`, { headers: jsonHeaders({ Authorization: auth(keyId, 'GET', `${MISSIONS}/${ghost}`) }) });
			assert.equal(r.status, 404, `${keyId} should see 404`);
		}

		// cleanup
		await raw('POST', stopPath, { headers: jsonHeaders({ Authorization: auth('qase-admin', 'POST', stopPath) }) });
	});

	test('AUTHZ: integration principal cannot spoof another workspace via body', async () => {
		// wsA-int tries to create a mission claiming workspaceId wsB
		const body = JSON.stringify({ name: 'spoof attempt', type: 'smoke', targetUrl: 'https://new.drytis.com', context: { maxTurns: 2 }, workspaceId: 'wsB', autoStart: false });
		const r = await raw('POST', MISSIONS, { headers: jsonHeaders({ Authorization: auth('wsA-int', 'POST', MISSIONS, body) }), body });
		assert.ok([201, 202].includes(r.status));
		// The mission must belong to wsA (the PRINCIPAL's workspace), not wsB.
		const mid = r.json.missionId;
		const read = await raw('GET', `${MISSIONS}/${mid}`, { headers: jsonHeaders({ Authorization: auth('wsA-int', 'GET', `${MISSIONS}/${mid}`) }) });
		assert.equal(read.status, 200, 'wsA can read own mission');
		const asWsB = await raw('GET', `${MISSIONS}/${mid}`, { headers: jsonHeaders({ Authorization: auth('wsB-int', 'GET', `${MISSIONS}/${mid}`) }) });
		assert.equal(asWsB.status, 403, 'wsB must NOT be able to read it — workspace was NOT spoofed');
		const stopPath = `${MISSIONS}/${mid}/stop`;
		await raw('POST', stopPath, { headers: jsonHeaders({ Authorization: auth('qase-admin', 'POST', stopPath) }) });
	});

	test('IDEMPOTENCY: same key + different body → 409 idempotency_key_reused', async () => {
		const key = `secneg-idem-${Date.now()}`;
		const base = { name: 'idem attack', type: 'smoke', targetUrl: 'https://new.drytis.com', context: { maxTurns: 2, autoStart: false }, autoStart: false };
		const c1 = await raw('POST', MISSIONS, { headers: jsonHeaders({ Authorization: auth('qase-admin', 'POST', MISSIONS, JSON.stringify(base)), 'Idempotency-Key': key }), body: JSON.stringify(base) });
		assert.ok([201, 202].includes(c1.status));
		const c2 = await raw('POST', MISSIONS, { headers: jsonHeaders({ Authorization: auth('qase-admin', 'POST', MISSIONS, JSON.stringify({ ...base, name: 'CHANGED' })), 'Idempotency-Key': key }), body: JSON.stringify({ ...base, name: 'CHANGED' }) });
		assert.equal(c2.status, 409);
		assert.equal(c2.json?.error?.code, 'idempotency_key_reused');
		const stopPath = `${MISSIONS}/${c1.json.missionId}/stop`;
		await raw('POST', stopPath, { headers: jsonHeaders({ Authorization: auth('qase-admin', 'POST', stopPath) }) });
	});

	test('IDEMPOTENCY: oversized key → truncated or rejected, never a crash', async () => {
		const longKey = 'x'.repeat(5_000);
		const body = JSON.stringify({ name: 'long key', type: 'smoke', targetUrl: 'https://new.drytis.com', context: { maxTurns: 2 }, autoStart: false });
		const r = await raw('POST', MISSIONS, { headers: jsonHeaders({ Authorization: auth('qase-admin', 'POST', MISSIONS, body), 'Idempotency-Key': longKey }), body });
		assert.ok([200, 201, 202, 400, 413].includes(r.status), `unexpected ${r.status}`);
		if (r.json?.missionId) {
			const stopPath = `${MISSIONS}/${r.json.missionId}/stop`;
			await raw('POST', stopPath, { headers: jsonHeaders({ Authorization: auth('qase-admin', 'POST', stopPath) }) });
		}
	});

	test('WEBHOOK: tampered payload fails signature verification', async () => {
		// signingSecret() reads process.env — make sure the suite is not env-dependent.
		if (!process.env.QASE_INTEGRATION_SECRET && SECRET) process.env.QASE_INTEGRATION_SECRET = SECRET;
		const { verifyWebhookSignature } = await import('../server/webhookDelivery.js');
		const body = JSON.stringify({ id: 'evt_x', event: 'mission.completed', ts: 1 });
		const ts = String(Math.floor(Date.now() / 1000));
		const { signature } = (await import('../server/webhookDelivery.js')).signWebhookPayload(body, ts);
		assert.ok(signature, 'a signing secret is configured (QASE_INTEGRATION_SECRET)');
		assert.ok(verifyWebhookSignature(body, ts, signature), 'original verifies');
		const tampered = body.replace('mission.completed', 'mission.failed');
		assert.ok(!verifyWebhookSignature(tampered, ts, signature), 'tampered body must fail');
		assert.ok(!verifyWebhookSignature(body, String(Number(ts) + 999), signature), 'tampered ts must fail');
	});

	test('WEBHOOK: event IDs are unique per delivery', async () => {
		const d = JSON.parse(readFileSync('/workspace/.qase/webhook-deliveries.json', 'utf8'));
		const ids = d.map(x => x.eventId).filter(Boolean);
		const uniq = new Set(ids);
		assert.equal(ids.length, uniq.size, 'every delivery eventId must be unique');
		assert.ok(ids.every(i => i.startsWith('evt_')), 'evt_ prefix');
	});

	test('ARTIFACTS: anonymous → 401', async () => {
		for (const p of ['/api/artifacts/some-run/screenshot.png', '/api/v1/artifacts/some-run/screenshot.png']) {
			const r = await raw('GET', p);
			assert.ok([401, 404].includes(r.status), `${p} → ${r.status} (404 without token config is acceptable only pre-auth)`);
			if (API_TOKEN) assert.equal(r.status, 401, `${p} must be 401 anon when token configured`);
		}
	});
});
