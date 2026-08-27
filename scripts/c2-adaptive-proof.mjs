#!/usr/bin/env node
/**
 * BUILD C2 — Phase 7 supplementary: single adaptive proof run.
 *
 * The A/B benchmark showed both arms reaching identical outcomes when the
 * agent consumes the entire turn pool in iteration 1 (decision gate then
 * only sees budget=0 → STOP_BUDGET for both). This run uses a SMOKE mission
 * (short agent run by design) with a deliberately larger turn pool, so the
 * session settles WITH budget remaining and the C2 decision rules
 * (INVESTIGATE / REPLAN / CONTINUE) get a live chance to fire — proving
 * the adaptive branch changes execution vs the non-adaptive single pass.
 *
 * Output: mission id, final status, decision trace, findings, turns.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.QASE_TEST_BASE_URL || 'http://localhost:5173';
const TOKEN = readFileSync('/workspace/.env', 'utf8').match(/^QASE_API_TOKEN=(.+)$/m)[1].trim();
const SECRET = readFileSync('/workspace/.env', 'utf8').match(/^QASE_INTEGRATION_SECRET=(.+)$/m)[1].trim();
const KEY_ID = 'qase-admin';
const MAX_TURNS = Number(process.env.C2_ADAPTIVE_TURNS || 12);

function sign(method, path, body = '') {
	const ts = String(Date.now());
	const nonce = randomBytes(8).toString('hex');
	const bodyHash = createHmac('sha256', '').update(body).digest('hex');
	const sig = createHmac('sha256', SECRET).update(`${method}\n${path}\n${ts}\n${nonce}\n${bodyHash}`).digest('hex');
	return `QASE-HMAC-SHA256 ${KEY_ID}:${ts}:${nonce}:${sig}`;
}
async function icall(method, path, bodyObj) {
	const body = bodyObj === undefined ? '' : JSON.stringify(bodyObj);
	const res = await fetch(`${BASE}${path}`, {
		method, headers: { 'Content-Type': 'application/json', Authorization: sign(method, path, body) },
		body: body || undefined, signal: AbortSignal.timeout(60_000)
	});
	let json = null; try { json = await res.json(); } catch { }
	return { status: res.status, json };
}
async function acall(path) {
	const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(30_000) });
	let json = null; try { json = await res.json(); } catch { }
	return { status: res.status, json };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const label = process.argv[2] || 'adaptive';
const target = process.argv[3] || 'http://localhost:9902';
const created = await icall('POST', '/api/v1/integration/missions', {
	name: `C2 ${label} proof`, type: 'smoke', targetUrl: target,
	context: { maxTurns: MAX_TURNS }, autoStart: true,
	idempotency_key: `c2-${label}-${Date.now()}`
});
if (created.status !== 202) { console.error(`create failed ${created.status}:`, JSON.stringify(created.json)); process.exit(1); }
const id = created.json.id ?? created.json.missionId;
console.log(`mission ${id} → http://localhost:9902 (smoke, pool ${MAX_TURNS})`);

const t0 = Date.now();
let final = null;
for (;;) {
	const { json } = await icall('GET', `/api/v1/integration/missions/${id}`);
	if (['completed', 'failed', 'aborted', 'cancelled'].includes(json?.status)) { final = json; break; }
	if (Date.now() - t0 > 20 * 60_000) { final = { ...json, timedOut: true }; break; }
	await sleep(5000);
}

const trace = (await icall('GET', `/api/v1/integration/missions/${id}/decision-trace`)).json?.decisions ?? [];
const findings = (await acall(`/api/v2/findings?mission_id=${id}&page_size=100`)).json?.data ?? [];
const iter = (final?.iterations ?? []).at(-1);
const out = {
	label, missionId: id, target, type: 'smoke', authorizedTurns: MAX_TURNS,
	status: final?.status, stopReason: final?.stopReason ?? null,
	failureReason: final?.failureReason ?? null,
	turnsUsed: final?.turnsUsed ?? iter?.turnCount ?? null,
	iterations: final?.iterations?.length ?? 0,
	decisionCount: trace.length,
	decisions: trace.map(t => ({ cand: t.candidate_action, sel: t.selected_action, res: t.result, budget: `${t.budget_requested}/${t.budget_granted}` })),
	vocabulary: [...new Set(trace.map(t => t.candidate_action))],
	findingCount: findings.length,
	criticalFindings: findings.filter(f => f.severity === 'critical').length
};
console.log(JSON.stringify(out, null, 2));
try {
	writeFileSync('/workspace/.drytis/c2-adaptive-proof.json', JSON.stringify(out, null, 2));
} catch { /* diagnostics dir may not exist — fine */ }
