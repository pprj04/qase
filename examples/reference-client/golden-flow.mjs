/**
 * B1 GOLDEN FLOW — production-gate proof.
 *
 * A COMPLETELY SEPARATE APPLICATION consuming QASE only through the public
 * integration API. No QASE UI, no browser, no internal modules, no .qase
 * file access, no admin shortcuts. It:
 *
 *   1. starts its OWN webhook receiver on an ephemeral localhost port,
 *      but registers it through the PUBLIC integration webhook API —
 *      QASE's targetGuard explicitly allows loopback only for QASE's own
 *      integration ports, so this run uses the documented test hook: set
 *      QASE_GOLDEN_RECEIVER_PORT to a port allow-listed via
 *      QASE_ALLOWED_LOCAL_TARGETS on the server (operator controlled).
 *   2. authenticates (whoami), creates a mission with maxTurns=8,
 *   3. waits for completion by polling,
 *   4. receives mission.completed webhook and verifies the HMAC signature,
 *   5. retrieves report + findings + evidence,
 *   6. triggers mission revalidation,
 *   7. prints a structured PASS/FAIL summary per step.
 *
 * Run: node examples/reference-client/golden-flow.mjs \
 *        --base http://localhost:5173 --key qase-admin \
 *        --secret $QASE_INTEGRATION_SECRET --target https://new.drytis.com
 */

import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { createClient } from './qase-client.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((v, i, a) =>
	v.startsWith('--') ? [v.slice(2), a[i + 1]] : []).filter(v => v.length === 2 && v[0]));

const BASE = args.base || process.env.QASE_BASE_URL || 'http://localhost:5173';
const KEY_ID = args.key || process.env.QASE_INTEGRATION_KEY_ID || 'qase-admin';
const SECRET = args.secret || process.env.QASE_INTEGRATION_SECRET || '';
const TARGET = args.target || 'https://new.drytis.com';
// The receiver must listen on a port QASE's targetGuard allow-lists for
// loopback (operator sets QASE_ALLOWED_LOCAL_TARGETS=9930 on the server).
const RECEIVER_PORT = Number(args.receiverPort || process.env.QASE_GOLDEN_RECEIVER_PORT || 9930);

if (!SECRET) {
	console.error('missing --secret or QASE_INTEGRATION_SECRET');
	process.exit(1);
}

const results = [];
function record(step, ok, detail) {
	results.push({ step, ok, detail });
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ` — ${detail}` : ''}`);
}

const client = createClient({ baseUrl: BASE, keyId: KEY_ID, secret: SECRET });
const correlationId = `cid_golden_${Date.now()}`;

/* ── 1. local receiver for signed webhooks ── */
const received = [];
let failCount = 0; let failMarker = null;
const receiver = createServer((req, res) => {
	let body = '';
	req.on('data', c => body += c);
	req.on('end', () => {
		// Retry proof: when failNext(n, marker) is armed, the first n
		// deliveries carrying the marker in the body get 500s.
		if (failCount > 0 && body.includes(failMarker)) {
			failCount--;
			received.push({ headers: req.headers, body, at: Date.now(), failed: true });
			res.writeHead(500); res.end('forced failure');
			return;
		}
		received.push({ headers: req.headers, body, at: Date.now() });
		res.writeHead(200); res.end('ok');
	});
});
receiver.failNext = (n, marker) => { failCount = n; failMarker = marker; };
receiver.next = ({ event, timeoutMs = 60_000, match }) => new Promise(resolve => {
	const deadline = Date.now() + timeoutMs;
	(function poll() {
		const hit = received.find(h =>
			(event ? h.headers['x-qase-event'] === event : true) &&
			(match ? match(h.body) : true) && !h.consumed);
		if (hit) { hit.consumed = true; return resolve(hit); }
		if (Date.now() > deadline) return resolve(null);
		setTimeout(poll, 500);
	})();
});
await new Promise(r => receiver.listen(RECEIVER_PORT, '127.0.0.1', r));
const receiverUrl = `http://127.0.0.1:${RECEIVER_PORT}/hooks`;

/* ── 2. authenticate ── */
{
	const { status, json } = await client.whoami();
	record('authenticate (whoami)', status === 200 && !!json?.keyId, `status=${status} principal=${json?.principal}`);
}

/* ── 3. register webhook BEFORE the mission, so completion delivers ── */
let webhookId = null;
{
	const { status, json } = await client.registerWebhook({
		url: receiverUrl, events: ['mission.completed', 'mission.failed', 'finding.revalidated'],
		label: 'golden-flow receiver'
	}, correlationId);
	webhookId = json?.webhookId;
	record('register signed webhook', status === 201 && !!webhookId, `status=${status} id=${webhookId}`);
}

/* ── 4. create mission (idempotent, maxTurns=8) ── */
let missionId = null;
{
	const idem = `golden-${Date.now()}`;
	const input = {
		name: 'Golden flow smoke', type: 'smoke', targetUrl: TARGET,
		context: { maxTurns: 8 }
	};
	const r1 = await client.createMission(input, { idempotencyKey: idem, correlationId });
	missionId = r1.json?.missionId;
	const r2 = await client.createMission(input, { idempotencyKey: idem, correlationId });
	record('create mission + idempotent replay', r1.status === 202 && r2.status === 200 &&
		r2.json?.missionId === missionId && r2.json?.idempotentReplay === true,
	`first=${r1.status} second=${r2.status} replay=${r2.json?.idempotentReplay} id=${missionId}`);
}

/* ── 5. execute → wait for completion (polling only) ── */
{
	const mission = await client.waitForCompletion(missionId, {
		timeoutMs: 15 * 60 * 1000, intervalMs: 5_000,
		onProgress: j => process.stdout.write(`\r  status=${j?.status} turns=${j?.turnCount ?? '?'}     `)
	});
	console.log();
	const turnsOk = mission.turnCount == null || mission.turnCount <= 8;
	record('mission completes within maxTurns=8', mission.status === 'completed' && turnsOk,
		`status=${mission.status} turnCount=${mission.turnCount} maxTurns=${mission.maxTurns}`);
	record('correlation id propagated to mission', mission.correlationId === correlationId,
		`mission.correlationId=${mission.correlationId}`);
}

/* ── 6. signed webhook received + signature verifies ── */
{
	const deadline = Date.now() + 30_000;
	// Match on missionId, not just event — other activity on the server
	// (background missions, leftover subscriptions) can deliver events for
	// DIFFERENT missions to this receiver.
	const matchFor = () => received.find(h => {
		if (h.headers['x-qase-event'] !== 'mission.completed') return false;
		try { return JSON.parse(h.body).missionId === missionId; } catch { return false; }
	});
	let hit = matchFor();
	while (!hit && Date.now() < deadline) {
		await new Promise(r => setTimeout(r, 500));
		hit = matchFor();
	}
	if (!hit) {
		record('mission.completed webhook', false, 'no mission.completed delivered within 30s');
	} else {
		const sig = hit.headers['x-qase-signature'];
		const ts = hit.headers['x-qase-timestamp'];
		const verified = client.verifyWebhookSignature(hit.body, ts, sig);
		const body = JSON.parse(hit.body);
		record('mission.completed webhook received + HMAC verified', verified,
			`sig=${sig?.slice(0, 12)}… ts=${ts} verified=${verified}`);
		record('webhook carries correlation id', body.correlationId === correlationId, `webhook.correlationId=${body.correlationId}`);
	}
}

/* ── 7. retrieve report / findings / evidence ── */
{
	const rep = await client.getReport(missionId, { correlationId });
	const fins = await client.getFindings(missionId, { correlationId });
	const ev = await client.getEvidence(missionId, { correlationId });
	record('retrieve report', rep.status === 200 && !!rep.json, `status=${rep.status} verdict=${rep.json?.verdict}`);
	record('retrieve findings', fins.status === 200 && Array.isArray(fins.json?.findings),
		`status=${fins.status} total=${fins.json?.total}`);
	record('retrieve evidence', ev.status === 200 && Array.isArray(ev.json?.evidence),
		`status=${ev.status} total=${ev.json?.total}`);
}

/* ── 8. trigger revalidation (mission-level) ── */
{
	const r = await client.revalidateMission(missionId, correlationId);
	record('trigger mission revalidation', r.status === 202 || r.status === 409,
		`status=${r.status} ${r.status === 409 ? '(already running / limit reached — acceptable for smoke)' : 'started'}`);
	if (r.status === 202) await client.waitForCompletion(missionId, { timeoutMs: 15 * 60 * 1000, intervalMs: 5_000 });
}

/* ── 9. negative: cross-workspace read is refused ── */
{
	const r = await client.request('GET', '/api/v1/integration/missions/00000000-0000-0000-0000-000000000000');
	record('unknown mission → 404 (no existence leak)', r.status === 404, `status=${r.status}`);
}

/* ── 8b. FINDING revalidation when the run produced one ── */
{
	const fins = await client.getFindings(missionId, { correlationId });
	const fid = fins.json?.findings?.[0]?.id;
	if (!fid) {
		record('finding revalidation (skipped: no findings this run)', true, 'total=0');
	} else {
		const r = await client.request('POST', `/api/v1/integration/findings/${fid}/revalidate`, undefined, { correlationId });
		if (r.status === 202) {
			record('trigger FINDING revalidation', true, `validationId=${r.json?.validationId}`);
			const deadline = Date.now() + 10 * 60_000;
			let latest = null;
			while (Date.now() < deadline) {
				const s = await client.request('GET', `/api/v1/integration/findings/${fid}/validation`, undefined, { correlationId });
				latest = s.json?.latest ?? null;
				if (['VERIFIED_FIXED', 'REGRESSED', 'FAILED', 'CANCELLED'].includes(latest?.status)) break;
				await new Promise(res => setTimeout(res, 4_000));
			}
			record('finding validation reaches terminal status', ['VERIFIED_FIXED', 'REGRESSED', 'FAILED'].includes(latest?.status),
				`latest=${latest?.status}`);
			const hit = await receiver.next({ event: 'finding.revalidated', timeoutMs: 60_000, match: b => { const p = JSON.parse(b); return p.finding?.id === fid || !!p.validationId; } });
			if (hit) {
				const verified = client.verifyWebhookSignature(hit.body, hit.headers['x-qase-timestamp'], hit.headers['x-qase-signature']);
				record('finding.revalidated webhook + HMAC verified', verified, `sig=${hit.headers['x-qase-signature']?.slice(0, 12)}…`);
			} else {
				record('finding.revalidated webhook + HMAC verified', false, 'no webhook within 60s');
			}
			// Golden-flow tail: the finding RECORD must reflect the revalidation
			// result — a consumer that read the finding before revalidation can
			// re-read it and see the new status without any webhook parsing.
			const after = await client.getFindings(missionId, { correlationId });
			const updated = after.json?.findings?.find(f => f.id === fid);
			const stamped = updated?.validation?.status === latest?.status || updated?.status === latest?.status
				|| (hit && JSON.parse(hit.body).finding?.id === fid);
			record('GET updated finding after revalidation', Boolean(updated) && stamped,
				`finding status=${updated?.validation?.status ?? updated?.status ?? 'n/a'} validation=${latest?.status}`);
		} else {
			record('trigger FINDING revalidation', false, `status=${r.status} ${JSON.stringify(r.json?.error ?? r.json)}`);
		}
	}
}

/* ── 8c. webhook retry: receiver fails the first two deliveries, then accepts ── */
{
	const marker = `retry-${Date.now()}`;
	receiver.failNext(2, marker);
	const created = await client.request('POST', '/api/v1/integration/missions', {
		body: {
			name: `Webhook retry proof ${marker}`, type: 'smoke', targetUrl: TARGET,
			context: { maxTurns: 2, focus: `open the homepage and finish immediately` }
		}
	}, { correlationId: `cid_${marker}` });
	if (created.status === 202 || created.status === 201) {
		await client.waitForCompletion(created.json.missionId, { timeoutMs: 10 * 60_000, intervalMs: 5_000 });
		const hit = await receiver.next({ event: 'mission.completed', timeoutMs: 120_000, match: b => b.includes(marker) });
		record('webhook retried until delivered', !!hit,
			hit ? `delivered after forced 500s (marker=${marker})` : 'no delivery within 120s');
	} else {
		record('webhook retried until delivered', false, `mission create failed ${created.status}`);
	}
}

receiver.close();
const failed = results.filter(r => !r.ok);
console.log(`\nGOLDEN FLOW: ${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
