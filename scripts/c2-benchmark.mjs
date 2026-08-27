#!/usr/bin/env node
/**
 * BUILD C2 — Phase 6/7 benchmark: autonomous (B) vs non-adaptive (A) on the
 * local benchmark apps + new.drytis.com.
 *
 * A = context.autonomy=false  (legacy: engine decision never dispatches;
 *     every mission is a single pass + finalize)
 * B = default autonomy        (engine decides CONTINUE/INVESTIGATE/REPLAN/STOP
 *     between iterations, bounded by the mission turn pool)
 *
 * Controlled runs: identical mission configs except the autonomy switch.
 * Output: JSON to .drytis/c2-benchmark-results.json + human summary.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.QASE_TEST_BASE_URL || 'http://localhost:5173';
const TOKEN = readFileSync('/workspace/.env', 'utf8').match(/^QASE_API_TOKEN=(.+)$/m)[1].trim();
const SECRET = readFileSync('/workspace/.env', 'utf8').match(/^QASE_INTEGRATION_SECRET=(.+)$/m)[1].trim();
const KEY_ID = 'qase-admin';
const TURNS = Number(process.env.C2_BENCH_TURNS || 6);

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

async function waitForTerminal(id, timeoutMs) {
	const start = Date.now();
	for (;;) {
		const { json } = await icall('GET', `/api/v1/integration/missions/${id}`);
		if (['completed', 'failed', 'aborted', 'cancelled'].includes(json?.status)) return json;
		if (Date.now() - start > timeoutMs) return { ...json, timedOut: true };
		await sleep(5000);
	}
}

async function traceFor(id) {
	const { json } = await icall('GET', `/api/v1/integration/missions/${id}/decision-trace`);
	return json?.decisions ?? [];
}

async function findingsFor(id) {
	// v2 /findings?mission_id= only matches findings carrying a missionId
	// field. Iteration findings created during the mission run historically
	// don't set it — fall back to the mission document itself (authoritative:
	// findingsCount + per-iteration finding arrays).
	const { json } = await acall(`/api/v1/missions/${id}`);
	const iterFindings = (json?.iterations ?? []).flatMap(it => it.findings ?? []);
	if (iterFindings.length > 0) return iterFindings;
	const v2 = await acall(`/api/v2/findings?mission_id=${id}&page_size=100`);
	return v2.json?.data ?? [];
}

async function runOne(label, targetUrl, autonomy, maxTurns) {
	const created = await icall('POST', '/api/v1/integration/missions', {
		name: `C2 bench ${label}`, type: 'full_audit', targetUrl,
		context: { maxTurns, autonomy }, autoStart: true,
		idempotency_key: `c2-bench-${label}-${Date.now()}`
	});
	if (created.status !== 202) throw new Error(`create failed ${created.status}: ${JSON.stringify(created.json)}`);
	const id = created.json.id ?? created.json.missionId;
	const budgetDeadline = 14 * 60_000;
	const final = await waitForTerminal(id, budgetDeadline);
	const traces = await traceFor(id);
	const findings = await findingsFor(id);
	return {
		label, targetUrl, autonomy, authorizedTurns: maxTurns,
		missionId: id,
		status: final?.status,
		turnsUsed: final?.turnsUsed ?? final?.turnCount ?? null,
		stopReason: final?.stopReason ?? null,
		failureReason: final?.failureReason ?? null,
		decisionCount: traces.length,
		decisions: traces.map(t => ({ cand: t.candidate_action, sel: t.selected_action, res: t.result, budget: `${t.budget_granted}/${t.budget_requested}` })),
		findingCount: findings.length,
		criticalFindings: findings.filter(f => f.severity === 'critical').length,
		highFindings: findings.filter(f => f.severity === 'high').length,
		timedOut: Boolean(final?.timedOut)
	};
}

const TARGETS = [
	{ name: 'local-9901 (crm)', url: 'http://localhost:9901' },
	{ name: 'local-9902 (taskboard)', url: 'http://localhost:9902' },
	{ name: 'local-9903 (shop)', url: 'http://localhost:9903' },
	{ name: 'new.drytis.com', url: 'https://new.drytis.com' }
];

const results = [];
for (const t of TARGETS) {
	for (const [variant, autonomy] of [['A-off', false], ['B-auto', true]]) {
		const label = `${t.name.split(' ')[0]}-${variant}`;
		process.stdout.write(`running ${label} (${TURNS} turns)… `);
		try {
			const r = await runOne(label, t.url, autonomy, TURNS);
			results.push(r);
			console.log(`${r.status} | decisions=${r.decisionCount} | findings=${r.findingCount} | turns=${r.turnsUsed ?? '?'}${r.timedOut ? ' TIMEOUT' : ''}`);
		} catch (e) {
			console.log(`ERROR: ${e.message}`);
			results.push({ label, targetUrl: t.url, autonomy, error: e.message });
		}
	}
}

mkdirSync('/workspace/.drytis', { recursive: true });
writeFileSync('/workspace/.drytis/c2-benchmark-results.json', JSON.stringify(results, null, 2));

console.log('\n===== C2 BENCHMARK SUMMARY =====');
console.log('label                    | status    | dec | findings(crit) | turns | stop');
for (const r of results) {
	console.log(
		(r.label ?? '?').padEnd(24) + '| ' +
		String(r.status ?? 'ERR').padEnd(10) + '| ' +
		String(r.decisionCount ?? '-').padEnd(4) + '| ' +
		`${r.findingCount ?? '-'}(${r.criticalFindings ?? '-'})`.padEnd(15) + '| ' +
		String(r.turnsUsed ?? '-').padEnd(6) + '| ' +
		String(r.stopReason ?? r.failureReason ?? '')
	);
}
const decisionsUsed = new Set(results.flatMap(r => (r.decisions ?? []).map(d => d.cand)));
console.log('\ndecision vocabulary observed:', [...decisionsUsed].join(', ') || '(none)');
