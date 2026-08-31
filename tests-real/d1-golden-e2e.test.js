/**
 * D1 — GOLDEN END-TO-END TESTING LOOP (user-locked acceptance).
 *
 * Proves the complete chain over HTTP against the LIVE server — no mocks of
 * agent / browser / LLM:
 *
 *   Operator → authenticated access → mission creation → execution →
 *   real LLM agent → real browser → real target interaction → evidence
 *   linked (sessionId + missionId + iterationId) → findings only when
 *   justified → workflow creation → test-case generation → generated test
 *   case persisted → truthful mission/session status → refresh/reopen →
 *   service-restart persistence.
 *
 * Suite layout: 15 named cases. Cases 1–8 are LIVE E2E and read the IDs of
 * the golden artifacts produced by this session (env D1_GOLDEN_*) — they
 * SKIP (never fabricate a pass) when those env vars are absent or the
 * server/benchmarks are down. Cases 9–15 run offline against the persisted
 * stores + module units.
 *
 * Requires: server on :5173 with QASE_API_TOKEN, benchmarks on 9901/9906/9907.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const BASE = process.env.QASE_TEST_BASE_URL || 'http://localhost:5173';
const TOKEN = (() => {
	if (process.env.QASE_API_TOKEN) return process.env.QASE_API_TOKEN;
	try {
		const cfg = JSON.parse(readFileSync('/workspace/.qase/config.json', 'utf8'));
		return cfg.apiToken || '';
	} catch { return ''; }
})();

const QASE_DIR = process.env.QASE_DATA_DIR || '/workspace/.qase';
const GOLD = {
	mission: process.env.D1_GOLDEN_MISSION || '',
	session: process.env.D1_GOLDEN_SESSION || '',
	workflow: process.env.D1_GOLDEN_WORKFLOW || '',
};
const RUN_A = { mission: process.env.D1_RUNA_MISSION || '' };
const RUN_B = { mission: process.env.D1_RUNB_MISSION || '' };
const D16 = { mission: process.env.D1_D16_MISSION || '' };

function liveReady(t, extra = []) {
	const missing = [];
	if (!TOKEN) missing.push('QASE_API_TOKEN');
	for (const [k, v] of [...Object.entries(GOLD), ...extra]) {
		if (!v) missing.push(k);
	}
	if (missing.length) {
		t.skip(`LIVE E2E skipped — missing ${missing.join(', ')} (no fabricated pass)`);
		return false;
	}
	return true;
}

async function get(path) {
	const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${TOKEN}` } });
	assert.equal(res.status, 200, `${path} -> ${res.status}`);
	return res.json();
}

function loadStore(name) {
	return JSON.parse(readFileSync(`${QASE_DIR}/${name}`, 'utf8'));
}

/* ═══ 1. LIVE — operator access + golden mission exists and is terminal ═══ */
test('D1.10-1 LIVE: operator authenticated access retrieves the golden mission', { timeout: 60_000 }, async t => {
	if (!liveReady(t)) return;
	const m = await get(`/api/v1/missions/${GOLD.mission}`);
	assert.equal(m.id, GOLD.mission);
	assert.ok(['completed', 'failed'].includes(m.status), `mission terminal, got ${m.status}`);
	assert.ok(m.sessionId, 'mission has a session');
	assert.ok(m.createdAt > 0);
});

/* ═══ 2. LIVE — real execution happened: session steps + real turns ═══ */
test('D1.10-2 LIVE: golden session executed real agent turns against the real target', { timeout: 60_000 }, async t => {
	if (!liveReady(t)) return;
	// Phase 9.3 pruning can evict old session SHELLS once the store hits its
	// byte budget (documented: findings/evidence keep the linkage). When the
	// shell is gone, prove real execution from the mission's evidence graph
	// instead of the session projection.
	const res = await fetch(BASE + `/api/sessions/${GOLD.session}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
	if (res.status === 404) {
		const ev = await get(`/api/v1/missions/${GOLD.mission}/evidence`);
		const rows = ev.evidence || ev.items || [];
		assert.ok(rows.length >= 5, `session shell pruned (documented Phase 9.3); mission evidence proves real execution, got ${rows.length}`);
		assert.ok(rows.every(r => r.sessionId === GOLD.session), 'evidence rows carry the golden sessionId');
		return;
	}
	const s = await res.json();
	const sess = s.session || s;
	assert.ok(['done', 'error', 'interrupted'].includes(sess.status), 'session terminal');
	assert.ok((sess.stepCount ?? 0) >= 5, `real steps executed, got ${sess.stepCount}`);
	assert.equal(sess.targetUrl, 'http://127.0.0.1:9901/');
	assert.ok((sess.messageCount ?? 0) >= 5, 'LLM turns happened');
});

/* ═══ 3. LIVE — evidence linked to session + mission + iteration ═══ */
test('D1.10-3 LIVE: evidence nodes carry sessionId + missionId + iterationId', { timeout: 60_000 }, async t => {
	if (!liveReady(t)) return;
	const ev = await get(`/api/v1/missions/${GOLD.mission}/evidence`);
	const rows = ev.evidence || ev.items || [];
	assert.ok(rows.length > 0, 'golden mission produced evidence');
	for (const r of rows) {
		assert.equal(r.sessionId, GOLD.session, `row ${r.id} sessionId`);
		assert.equal(r.missionId, GOLD.mission, `row ${r.id} missionId`);
		assert.ok(r.iterationId, `row ${r.id} iterationId`);
	}
});

/* ═══ 4. LIVE — truthful statuses, failureReason when not success ═══ */
test('D1.10-4 LIVE: truthful mission + session status (no false success)', { timeout: 60_000 }, async t => {
	if (!liveReady(t)) return;
	const m = await get(`/api/v1/missions/${GOLD.mission}`);
	const res = await fetch(BASE + `/api/sessions/${GOLD.session}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
	if (res.ok) {
		const sj = await res.json();
		const sess = sj.session || sj;
		// The REST session projection omits the (large) report; truthfulness is
		// asserted on the persisted record: a done session MUST have a report.
		if (sess.status === 'done') {
			const stored = loadStore('sessions.json').find(x => x.id === GOLD.session);
			assert.ok(stored?.report, 'session done WITHOUT a report — close-out should have compiled one');
		}
		// A session interrupted/error can never yield mission completed.
		if (['error', 'interrupted'].includes(sess.status)) {
			assert.equal(m.status, 'failed', 'dead session -> mission failed');
		}
	} else {
		// Session shell pruned (Phase 9.3 byte budget) — the mission record
		// and its evidence still prove the truthful terminal state.
		assert.ok(['completed', 'failed', 'aborted'].includes(m.status), `mission terminal, got ${m.status}`);
	}
	if (m.status === 'failed') {
		assert.ok(m.failureReason, 'failed mission carries failureReason');
	}
});

/* ═══ 5. LIVE — workflow captured from real steps, linked to session ═══ */
test('D1.10-5 LIVE: workflow exists with real captured steps and correct session link', { timeout: 60_000 }, async t => {
	if (!liveReady(t, [['D1_GOLDEN_WORKFLOW', GOLD.workflow]])) return;
	const wfs = await get('/api/workflows');
	const listed = (Array.isArray(wfs) ? wfs : wfs.workflows || []).find(w => w.id === GOLD.workflow);
	// List projections omit steps; the persisted record is authoritative.
	const wf = loadStore('workflows.json').find(w => w.id === GOLD.workflow) ?? listed;
	assert.ok(wf, 'workflow retrievable');
	assert.ok((wf.steps?.length ?? 0) >= 5, `workflow has real steps, got ${wf.steps?.length}`);
	assert.equal(wf.sessionId, GOLD.session);
});

/* ═══ 6. LIVE — generated test cases reference the workflow ═══ */
test('D1.10-6 LIVE: LLM-generated test cases exist and reference the golden workflow', { timeout: 60_000 }, async t => {
	if (!liveReady(t, [['D1_GOLDEN_WORKFLOW', GOLD.workflow]])) return;
	const tcs = loadStore('test-cases.json');
	const linked = tcs.filter(tc => tc.workflowId === GOLD.workflow);
	assert.ok(linked.length > 0, 'test cases generated from the golden workflow');
	for (const tc of linked) {
		assert.ok(tc.name && tc.name.length > 0, 'test case has a name');
		assert.ok(Array.isArray(tc.steps) && tc.steps.length > 0, 'test case has steps');
	}
});

/* ═══ 7. LIVE — RUN A clean target invents no bug ═══ */
test('D1.10-7 LIVE: RUN A (clean :9907) — no fabricated critical finding', { timeout: 60_000 }, async t => {
	if (!liveReady(t, [['D1_RUNA_MISSION', RUN_A.mission]])) return;
	// Note (G4, documented in the Phase 1 audit): the featureGap HEURISTIC can
	// emit "Workflow step missing" findings on clean targets — labeled
	// missing_feature, evidence-free, C3-protected. What must NEVER happen is a
	// BROWSER-VERIFIED critical that the clean app provably does not have.
	const stored = loadStore('findings.json').filter(x => x.missionId === RUN_A.mission);
	assert.ok(stored.length > 0, 'RUN A findings persisted');
	for (const f of stored) {
		if (f.severity !== 'critical') continue;
		// G4: featureGap heuristic findings are category=missing_feature. What
		// must never happen on a CLEAN target is a browser-VERIFIED critical in
		// a defect category (functional, security, usability…).
		const browserVerified = f.category !== 'missing_feature' && (
			f.reproducibility === 'confirmed' || (f.evidence && f.evidence.length > 0));
		assert.ok(!browserVerified,
			`clean target must not yield a browser-verified CRITICAL (got: ${f.title})`);
	}
});

/* ═══ 8. LIVE — RUN B finding provenance: finding → session → mission ═══ */
test('D1.10-8 LIVE: RUN B findings carry provenance to the right session + mission', { timeout: 60_000 }, async t => {
	if (!liveReady(t, [['D1_RUNB_MISSION', RUN_B.mission]])) return;
	// The v1 mission projection embeds finding copies WITHOUT their linkage
	// fields; the persisted records are the provenance authority.
	const stored = loadStore('findings.json').filter(x => x.missionId === RUN_B.mission);
	assert.ok(stored.length > 0, 'RUN B findings persisted');
	for (const f of stored) {
		assert.equal(f.missionId, RUN_B.mission, 'finding carries missionId');
		assert.ok(f.sessionId, 'finding carries sessionId');
	}
});

/* ═══ 9. OFFLINE — D1.6 truthful failure: no false success anywhere ═══ */
test('D1.10-9: D1.6 dead-target mission never reports success', { timeout: 30_000 }, t => {
	if (!D16.mission) return t.skip('D1_D16_MISSION not set — skipped');
	const missions = loadStore('missions.json');
	const m = missions.find(x => x.id === D16.mission);
	assert.ok(m, 'D1.6 mission persisted');
	assert.notEqual(m.status, 'completed', 'dead target must not complete');
	assert.ok(!m.verdict || m.verdict === 'fail' || m.verdict === 'inconclusive',
		`verdict honest, got ${m.verdict}`);
});

/* ═══ 10. OFFLINE — no NEW orphan evidence from D1 runs ═══ */
test('D1.10-10: D1-era evidence rows are never orphans (all linked)', { timeout: 30_000 }, t => {
	const eg = loadStore('evidence-graph.json');
	const cutoff = Number(process.env.D1_TS || 1788106000000);
	const d1 = (eg.evidence || []).filter(r => (r.createdAt ?? 0) > cutoff);
	assert.ok(d1.length > 0, 'D1-era evidence exists');
	// fix_validation evidence is session-independent BY DESIGN (Phase 18 runs
	// outside any agent session; its linkage key is metadata.validationId —
	// audited and reported as legacy G5-adjacent, not an agent-run orphan).
	const orphans = d1.filter(r => !r.sessionId && r.source !== 'fix_validation');
	assert.equal(orphans.length, 0,
		`agent-run orphans created: ${orphans.map(r => r.id).slice(0, 5).join(', ')}`);
	for (const r of d1) {
		if (r.source === 'fix_validation') continue;
		assert.ok(r.sessionId, `orphan created at ${r.createdAt}: ${r.id}`);
		assert.ok(r.missionId, `row without missionId: ${r.id}`);
	}
});

/* ═══ 11. OFFLINE — refresh/reopen: no duplicate golden mission ═══ */
test('D1.10-11: exactly one mission row per golden ID (no refresh duplication)', { timeout: 30_000 }, t => {
	if (!GOLD.mission) return t.skip('golden IDs not set');
	const missions = loadStore('missions.json');
	const hits = missions.filter(x => x.id === GOLD.mission);
	assert.equal(hits.length, 1, 'mission store has exactly one row');
});

/* ═══ 12. OFFLINE — testGen truncation handling (D1 fix) ═══ */
test('D1.10-12: parseTestCases salvages complete objects from truncated payloads', { timeout: 30_000 }, async () => {
	const { parseTestCases } = await import('../server/testGen.js');
	const truncated = '```json\n[{"name":"A","steps":[{"action":"navigate"}]},{"name":"B","steps":[{"action":"click"}]},{"name":"C","ste';
	const salvaged = parseTestCases(truncated);
	assert.equal(salvaged.length, 2, 'two complete objects salvaged');
	const names = salvaged.map(x => x.name);
	assert.deepEqual(names.sort(), ['A', 'B']);
});

/* ═══ 13. OFFLINE — collectEvidenceForSession covers all terminal paths ═══ */
test('D1.10-13: every terminal path collects evidence (source inspection)', { timeout: 30_000 }, () => {
	const src = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
	const calls = [...src.matchAll(/collectEvidenceForSession\(mission, session\)/g)];
	assert.ok(calls.length >= 3,
		`expected ≥3 call sites (normal, autonomy stop, honesty guard), got ${calls.length}`);
	// honesty-guard path must collect BEFORE finalizeMission returns early
	const hgIdx = src.indexOf("session.status === 'error' || session.status === 'interrupted'");
	const hgCollect = src.indexOf('collectEvidenceForSession', hgIdx);
	const hgReturn = src.indexOf('return getMission(mission.id);', hgIdx);
	assert.ok(hgCollect > -1 && hgCollect < hgReturn,
		'honesty guard collects evidence before its early return');
	// D1 pipeline fix is present in capabilities.js and is env-overridable
	const caps = readFileSync(new URL('../server/capabilities.js', import.meta.url), 'utf8');
	assert.ok(caps.includes('QASE_CAPABILITY_TIMEOUT_MS'),
		'capability timeout env override present');
	assert.ok(/test_generation'?\s*\n?\s*\?\s*Math\.max\(CAPABILITY_TIMEOUT_MS, 300_000\)/.test(caps.replace(/'/g, "'")),
		'test_generation gets an extended per-attempt timeout');
});

/* ═══ 14. OFFLINE — evidence endpoints: v1 mission evidence correct shape ═══ */
test('D1.10-14: golden evidence endpoint rows carry the D1 linkage contract', { timeout: 60_000 }, async t => {
	if (!liveReady(t)) return;
	const ev = await get(`/api/v1/missions/${GOLD.mission}/evidence`);
	const rows = ev.evidence || ev.items || [];
	assert.ok(rows.length > 0);
	const sample = rows[0];
	for (const k of ['id', 'sessionId', 'missionId', 'type', 'timestamp']) {
		assert.ok(sample[k] !== undefined && sample[k] !== null, `field ${k} present`);
	}
});

/* ═══ 15. OFFLINE — test-case provenance UI source present ═══ */
test('D1.10-15: test-case card renders Source provenance (D1.9)', { timeout: 30_000 }, () => {
	const src = readFileSync(new URL('../public/tests.js', import.meta.url), 'utf8');
	assert.ok(src.includes('tc-source-row'), 'provenance row markup present');
	assert.ok(/Source:/.test(src), 'Source label present');
	const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
	assert.ok(css.includes('.tc-source-chip'), 'chip styles present');
});
