'use strict';

/**
 * B1 W6 regression — mission turn budget on the /start and /revalidate paths.
 *
 * Reviewer finding (round 1): startMissionByIdHandler and
 * revalidateMissionByIdHandler never stamped session.maxTurns, so a mission
 * created with autoStart:false and context.maxTurns:N ran under the GLOBAL
 * default (120) while the status API advertised N. This suite proves the
 * budget reaches the agent on every execution path via the INTEGRATION API:
 *
 *   1. create (autoStart:false, maxTurns=3) → POST :id/start → session
 *      executes ≤3 turns.
 *   2. same mission → POST :id/revalidate → second iteration also ≤3 turns.
 *
 * Requires a live server + QASE_INTEGRATION_SECRET (same convention as the
 * other B1 live suites).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';

const BASE = process.env.QASE_TEST_BASE_URL || 'http://localhost:5173';
const KEY_ID = 'qase-admin';
const SECRET = (() => {
	try {
		const env = readFileSync('/workspace/.env', 'utf8');
		return env.match(/^QASE_INTEGRATION_SECRET=(.+)$/m)[1].trim();
	} catch { return process.env.QASE_INTEGRATION_SECRET || ''; }
})();

function sign(method, path, body = '') {
	const ts = String(Date.now());
	const nonce = randomBytes(8).toString('hex');
	const bodyHash = createHmac('sha256', '').update(body).digest('hex');
	const sig = createHmac('sha256', SECRET).update(`${method}\n${path}\n${ts}\n${nonce}\n${bodyHash}`).digest('hex');
	return `QASE-HMAC-SHA256 ${KEY_ID}:${ts}:${nonce}:${sig}`;
}

async function icall(method, path, bodyObj, extraHeaders = {}) {
	const body = bodyObj === undefined ? '' : JSON.stringify(bodyObj);
	const res = await fetch(`${BASE}${path}`, {
		method,
		headers: { 'Content-Type': 'application/json', Authorization: sign(method, path, body), ...extraHeaders },
		body: body || undefined,
		signal: AbortSignal.timeout(30_000)
	});
	let json = null; try { json = await res.json(); } catch { /* text */ }
	return { status: res.status, json };
}

async function waitForTerminal(id, timeoutMs = 15 * 60_000) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const { json } = await icall('GET', `/api/v1/integration/missions/${id}`);
		if (['completed', 'failed', 'aborted', 'cancelled'].includes(json.status)) return json;
		if (Date.now() > deadline) throw new Error(`timeout: status=${json.status}`);
		await new Promise(r => setTimeout(r, 5000));
	}
}

describe('B1 W6 — turn budget on /start and /revalidate paths', { skip: !SECRET }, () => {
	test('autoStart:false + maxTurns=3 → /start executes ≤3 turns; revalidate too', async () => {
		const key = `w6-start-path-${Date.now()}`;
		const created = await icall('POST', '/api/v1/integration/missions',
			{
				name: 'W6 start-path budget', type: 'smoke', targetUrl: 'https://new.drytis.com',
				context: { maxTurns: 3 }, autoStart: false
			}, { 'Idempotency-Key': key });
		assert.equal(created.status, 201, `create status ${created.status}`);
		const id = created.json.missionId;

		const started = await icall('POST', `/api/v1/integration/missions/${id}/start`);
		assert.equal(started.status, 202, `start status ${started.status}`);

		const mission = await waitForTerminal(id);
		assert.equal(mission.status, 'completed', `status=${mission.status} reason=${mission.failureReason ?? ''}`);
		assert.equal(mission.maxTurns, 3);
		assert.ok(mission.turnCount == null || mission.turnCount <= 3,
			`START path exceeded budget: turnCount=${mission.turnCount}`);

		// Second execution path: revalidate must ALSO respect the budget.
		const revalidated = await icall('POST', `/api/v1/integration/missions/${id}/revalidate`);
		assert.ok([202, 409].includes(revalidated.status), `revalidate status ${revalidated.status}`);
		if (revalidated.status === 202) {
			const after = await waitForTerminal(id);
			assert.ok(['completed', 'failed'].includes(after.status), `reval status=${after.status}`);
			assert.ok(after.turnCount == null || after.turnCount <= 3,
				`REVALIDATE path exceeded budget: turnCount=${after.turnCount}`);
		}
	}, 20 * 60_000);
});
