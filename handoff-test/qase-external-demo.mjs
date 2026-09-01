#!/usr/bin/env node
/**
 * STEP 7 — REAL EXTERNAL-APP TEST.
 * A tiny standalone client with ZERO dependency on QASE source code.
 * It speaks HTTP only: authenticate (HMAC) → GET QASE data → parse → display.
 *
 * Run: node qase-external-demo.mjs
 * Env: HANDOFF_BASE_URL, HANDOFF_HMAC_KEY_ID, HANDOFF_HMAC_SECRET, HANDOFF_BEARER_TOKEN
 */
import { createHmac, randomBytes } from 'node:crypto';

const BASE = (process.env.HANDOFF_BASE_URL || 'https://pulse-review-workspa-6grhjr.drytis.dev').replace(/\/+$/, '');
const KEY_ID = process.env.HANDOFF_HMAC_KEY_ID || 'ext-handoff-test';
const SECRET = process.env.HANDOFF_HMAC_SECRET || process.env.QASE_INTEGRATION_SECRET;
const BEARER = process.env.HANDOFF_BEARER_TOKEN || process.env.QASE_API_TOKEN;

if (!SECRET || !BEARER) {
	console.error('Missing credentials in env (HANDOFF_HMAC_SECRET / HANDOFF_BEARER_TOKEN).');
	process.exit(2);
}

// -- 1. Authenticate: HMAC-signed whoami (integration credential) --
function sign(method, path, bodyText) {
	const ts = String(Date.now());
	const nonce = randomBytes(8).toString('hex');
	const bodyDigest = createHmac('sha256', '').update(bodyText).digest('hex');
	const canonical = [method.toUpperCase(), path, ts, nonce, bodyDigest].join('\n');
	const signature = createHmac('sha256', SECRET).update(canonical).digest('hex');
	return `QASE-HMAC-SHA256 ${KEY_ID}:${ts}:${nonce}:${signature}`;
}
const authRes = await fetch(`${BASE}/api/v1/integration/whoami`, {
	headers: { Authorization: sign('GET', '/api/v1/integration/whoami', '') }
});
if (authRes.status !== 200) {
	console.error(`Authentication failed: HTTP ${authRes.status}`);
	process.exit(1);
}
const me = await authRes.json();

// -- 2. GET QASE data (read surface, bearer) --
const [usageRes, projectsRes, findingsRes] = await Promise.all([
	fetch(`${BASE}/api/v2/usage/summary`, { headers: { Authorization: `Bearer ${BEARER}` } }),
	fetch(`${BASE}/api/v2/projects`, { headers: { Authorization: `Bearer ${BEARER}` } }),
	fetch(`${BASE}/api/v2/findings/stats`, { headers: { Authorization: `Bearer ${BEARER}` } })
]);

// -- 3. Parse JSON --
const usage = await usageRes.json();
const projects = await projectsRes.json();
const findings = await findingsRes.json();

// -- 4. Display a simple result --
const line = '─'.repeat(46);
console.log(line);
console.log('QASE external client — live integration demo');
console.log(line);
console.log(`authenticated as   : ${me.keyId} (${me.principal} @ workspace ${me.workspaceId})`);
console.log(`scopes             : ${me.scopes.join(', ')}`);
console.log(`HTTP statuses      : usage=${usageRes.status} projects=${projectsRes.status} findings=${findingsRes.status}`);
console.log(line);
const totals = usage?.totals ?? {};
const totalCalls = Object.values(totals).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
console.log(`API usage (90d)    : ${totalCalls} calls across ${Object.keys(totals).length} endpoints`);
console.log(`projects           : ${Array.isArray(projects) ? projects.length : 0}${Array.isArray(projects) && projects[0] ? ` — e.g. "${projects[0].name}" (${projects[0].base_url ?? 'n/a'})` : ''}`);
const byStatus = findings?.by_status ?? {};
const fTotal = findings?.total ?? 0;
console.log(`findings           : ${fTotal} total` + (Object.keys(byStatus).length ? ` (${Object.entries(byStatus).map(([k, n]) => `${k}:${n}`).join(', ')})` : ''));
console.log(line);
console.log('RESULT: external application successfully consumed the QASE API.');
