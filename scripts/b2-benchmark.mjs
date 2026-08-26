#!/usr/bin/env node
/**
 * BUILD B2 — W4: thin autonomy benchmark (A/B: old loop vs autonomy loop).
 *
 * For each target (9901 CRM, 9902 TaskBoard, 9903 ShopHub):
 *   - Run A (QASE_AUTONOMY=off): the pre-B2 loop — session settles, fixed
 *     code finalizes, no decision point.
 *   - Run B (autonomy on): the decision engine evaluates the settled state,
 *     resolveAction picks the action, budget authority gates it, 13-field
 *     trace recorded.
 * Same turn budget for both. Captures:
 *   State → Information used → Candidate actions → Selected action →
 *   Safety/budget decision → Execution → Result → Next decision
 * and writes .drytis/b2-benchmark-results.json + a human-readable summary.
 *
 * Usage: node scripts/b2-benchmark.mjs [--targets 9901,9902,9903] [--turns 6]
 */

import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.QASE_TEST_BASE_URL || 'http://localhost:5173';
const SECRET = (() => {
	try {
		const env = readFileSync('/workspace/.env', 'utf8');
		return (env.match(/^QASE_INTEGRATION_SECRET=(.+)$/m)?.[1] || '').trim();
	} catch { return process.env.QASE_INTEGRATION_SECRET || ''; }
})();
const TOKEN = (() => {
	if (process.env.QASE_API_TOKEN) return process.env.QASE_API_TOKEN;
	try {
		const cfg = JSON.parse(readFileSync('/workspace/.qase/config.json', 'utf8'));
		return cfg.apiToken || '';
	} catch { return ''; }
})();

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const TARGET_PORTS = (argOf('--targets', '9901,9902,9903')).split(',').map(s => s.trim());
const TURNS = Number(argOf('--turns', '6'));

const APP_PROFILES = {
	9901: { name: 'app1-crm (SalesFlow CRM)', buildPrompt: 'CRM app with contacts, deals, forms, search, dashboard' },
	9902: { name: 'app2-taskboard (TaskBoard)', buildPrompt: 'Task board app with tasks, columns, drag and drop, forms' },
	9903: { name: 'app3-shop (ShopHub e-commerce)', buildPrompt: 'E-commerce app with products, cart, checkout, payment, forms' }
};

async function signed(method, path, body = null) {
	const bodyText = body == null ? '' : JSON.stringify(body);
	const ts = Date.now().toString();
	const nonce = randomUUID().replace(/-/g, '');
	const bodyHash = createHmac('sha256', '').update(bodyText).digest('hex');
	const signature = createHmac('sha256', SECRET).update(`${method.toUpperCase()}\n${path}\n${ts}\n${nonce}\n${bodyHash}`).digest('hex');
	const res = await fetch(`${BASE}${path}`, {
		method,
		headers: { 'Content-Type': 'application/json', Authorization: `QASE-HMAC-SHA256 qase-admin:${ts}:${nonce}:${signature}` },
		body: bodyText || undefined
	});
	let json = null;
	try { json = await res.json(); } catch { /* text */ }
	return { status: res.status, json };
}

async function getTrace(missionId) {
	const res = await fetch(`${BASE}/api/v1/missions/${missionId}/decision-trace`, { headers: { Authorization: `Bearer ${TOKEN}` } });
	if (!res.ok) return null;
	return res.json();
}

async function runMission(port, mode, label) {
	const target = `http://localhost:${port}`;
	const profile = APP_PROFILES[port] ?? { name: `port ${port}`, buildPrompt: 'web app' };
	const autonomyOff = mode === 'A-off';
	const created = await signed('POST', '/api/v1/integration/missions', {
		name: `B2 bench ${mode} ${label}`,
		type: 'full_audit',
		targetUrl: target,
		objectives: ['exercise main flows'],
		context: {
			maxTurns: TURNS,
			buildPrompt: profile.buildPrompt,
			// B2 W4 — per-mission autonomy switch: A-off sends autonomy:false
			// (decision engine skipped, no trace, legacy deterministic loop);
			// B-autonomy omits it (default on). No server restart needed.
			...(autonomyOff ? { autonomy: false } : {})
		},
		autoStart: true
	});
	if (![201, 202].includes(created.status)) throw new Error(`create failed ${created.status}: ${JSON.stringify(created.json)}`);
	const missionId = created.json.missionId;
	const started = Date.now();

	let mission = null;
	const deadline = Date.now() + 12 * 60_000;
	while (Date.now() < deadline) {
		const poll = await signed('GET', `/api/v1/integration/missions/${missionId}`);
		mission = poll.json;
		if (['completed', 'failed', 'aborted', 'cancelled', 'timeout'].includes(mission?.status)) break;
		await new Promise(r => setTimeout(r, 6_000));
	}
	const traceBody = await getTrace(missionId);
	return {
		target: `${target} (${profile.name})`,
		mode,
		missionId,
		terminalStatus: mission?.status ?? 'unknown',
		verdict: mission?.verdict ?? null,
		qualityScore: mission?.qualityScore ?? null,
		findingsCount: mission?.findings?.length ?? mission?.findingsCount ?? 0,
		decisionCount: traceBody?.count ?? 0,
		decisions: (traceBody?.decisions ?? []).map(d => ({
			state: d.state, candidate: d.candidate_action, selected: d.selected_action,
			reason: d.reason, budget_before: d.budget_before, budget_requested: d.budget_requested,
			budget_granted: d.budget_granted, result: d.result
		})),
		wallSeconds: Math.round((Date.now() - started) / 1000)
	};
}

console.log(`B2 thin benchmark — targets ${TARGET_PORTS.join(', ')} @ ${TURNS} turns, base ${BASE}`);
const results = [];
for (const port of TARGET_PORTS) {
	for (const mode of ['A-off', 'B-autonomy']) {
		// B2 W4 — real A/B: A-off sends context.autonomy=false (no server
		// restart, per-mission switch). Both modes run on the SAME server.
		console.log(`[${port}] running ${mode} …`);
		const r = await runMission(port, mode, new Date().toISOString().slice(11, 19));
		console.log(`  → ${r.terminalStatus} verdict=${r.verdict} findings=${r.findingsCount} decisions=${r.decisionCount} (${r.wallSeconds}s)`);
		for (const d of r.decisions) {
			console.log(`     decision: state=${d.state} candidate=${d.candidate} selected=${d.selected} granted=${d.budget_granted}/${d.budget_requested}`);
			console.log(`       reason: ${d.reason}`);
		}
		results.push(r);
	}
}

const out = {
	generatedAt: new Date().toISOString(),
	base: BASE,
	turnsBudget: TURNS,
	baseline: 'pre-B2 (docs/B2-BASELINE-SNAPSHOT.md): resolveAction 0 callers, no testContext, no traces — the loop was predetermined',
	runs: results
};
mkdirSync(join(__dirname, '..', '.drytis'), { recursive: true });
const outPath = join(__dirname, '..', '.drytis', 'b2-benchmark-results.json');
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`\nwrote ${outPath}`);
const nonContinue = results.flatMap(r => r.decisions).filter(d => d.candidate !== 'CONTINUE' && d.candidate !== undefined);
console.log(`non-CONTINUE decisions observed: ${nonContinue.length}`);
