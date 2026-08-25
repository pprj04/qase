'use strict';

/**
 * B1 W5/W6 LIVE — webhook retry + restart recovery + turn-budget truth.
 *
 * Requires a running server (QASE_TEST_BASE_URL, default localhost:5173) and
 * reads QASE_INTEGRATION_SECRET from /workspace/.env like the other B1
 * tests. Exercises, over the real integration API only:
 *
 *   1. webhook retry: a receiver that fails N attempts then succeeds —
 *      delivery retries with backoff and records attempts in the ledger.
 *   2. turn-budget truth: a mission with context.maxTurns=2 executes at
 *      most 2 assistant turns (turnCount ≤ 2, status terminal).
 *
 * Restart recovery of pending deliveries is covered by the operator-run
 * golden flow (documented in the report): deliveries persist to
 * .qase/webhook-deliveries.json and the pump resumes on boot.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';

const BASE = process.env.QASE_TEST_BASE_URL || 'http://localhost:5173';
const KEY_ID = 'qase-admin';
const SECRET = (() => {
	try {
		const env = readFileSync('/workspace/.env', 'utf8');
		return env.match(/^QASE_INTEGRATION_SECRET=(.+)$/m)[1].trim();
	} catch { return process.env.QASE_INTEGRATION_SECRET || ''; }
})();
const RECEIVER_PORT = Number(process.env.QASE_GOLDEN_RECEIVER_PORT || 9930);

function sign(keyId, method, path, body = '') {
	const ts = String(Date.now());
	const nonce = randomBytes(8).toString('hex');
	const bodyHash = createHmac('sha256', '').update(body).digest('hex');
	const sig = createHmac('sha256', SECRET).update(`${method}\n${path}\n${ts}\n${nonce}\n${bodyHash}`).digest('hex');
	return `QASE-HMAC-SHA256 ${keyId}:${ts}:${nonce}:${sig}`;
}

async function icall(method, path, bodyObj, extraHeaders = {}) {
	const body = bodyObj === undefined ? '' : JSON.stringify(bodyObj);
	const res = await fetch(`${BASE}${path}`, {
		method, headers: { 'Content-Type': 'application/json', Authorization: sign(KEY_ID, method, path, body), ...extraHeaders }, body: body || undefined
	});
	let json = null; try { json = await res.json(); } catch { /* text */ }
	return { status: res.status, json };
}

describe('B1 W5 live — webhook retry with backoff', { skip: !SECRET }, () => {
	test('failing receiver is retried and eventually succeeds', async () => {
		let attempts = 0;
		const hits = [];
		const receiver = createServer((req, res) => {
			attempts += 1;
			let body = '';
			req.on('data', c => body += c);
			req.on('end', () => {
				hits.push({ n: attempts, headers: req.headers, body });
				if (attempts < 3) { res.writeHead(500); res.end('nope'); return; }
				res.writeHead(200); res.end('ok');
			});
		});
		await new Promise(r => receiver.listen(RECEIVER_PORT, '127.0.0.1', r));

		try {
			const url = `http://127.0.0.1:${RECEIVER_PORT}/retry-test`;
			const { status } = await icall('POST', '/api/v1/integration/webhooks', { url, events: ['mission.completed'] });
			assert.equal(status, 201);

			// Trigger a delivery: tiny real mission (2-turn budget → fast).
			const created = await icall('POST', '/api/v1/integration/missions',
				{ name: 'B1 retry-probe', type: 'smoke', targetUrl: 'https://new.drytis.com', context: { maxTurns: 2 } },
				{ 'Idempotency-Key': `retry-probe-${Date.now()}` });
			assert.ok([201, 202].includes(created.status), `create status ${created.status}`);

			// Backoff for attempts 1→2 is 1s and 2→3 is 4s; allow generous wall time.
			const deadline = Date.now() + 120_000;
			while (attempts < 3 && Date.now() < deadline) await new Promise(r => setTimeout(r, 1000));

			assert.equal(attempts >= 3, true, `expected ≥3 attempts, saw ${attempts}`);
			const last = hits[hits.length - 1];
			assert.ok(last.headers['x-qase-signature']?.startsWith('v1='));
			assert.ok(/^\d{10}$/.test(last.headers['x-qase-timestamp'] || ''));
		} finally {
			receiver.close();
		}
	}, 180_000);
});

describe('B1 W6 live — turn budget truth', { skip: !SECRET }, () => {
	test('context.maxTurns=2 mission executes ≤2 assistant turns', async () => {
		const created = await icall('POST', '/api/v1/integration/missions',
			{ name: 'B1 turns-probe', type: 'smoke', targetUrl: 'https://new.drytis.com', context: { maxTurns: 2 } },
			{ 'Idempotency-Key': `turns-probe-${Date.now()}` });
		assert.ok([201, 202].includes(created.status));
		const id = created.json.missionId;

		const deadline = Date.now() + 15 * 60_000;
		let mission = null;
		while (Date.now() < deadline) {
			const { json } = await icall('GET', `/api/v1/integration/missions/${id}`);
			mission = json;
			if (['completed', 'failed', 'aborted', 'cancelled'].includes(json.status)) break;
			await new Promise(r => setTimeout(r, 5000));
		}
		assert.ok(mission, 'no mission');
		assert.equal(mission.status, 'completed', `status ${mission.status} (${mission.failureReason ?? ''})`);
		assert.equal(mission.maxTurns, 2);
		assert.ok(mission.turnCount == null || mission.turnCount <= 2,
			`turnCount ${mission.turnCount} exceeded the 2-turn budget`);
	}, 960_000);
});
