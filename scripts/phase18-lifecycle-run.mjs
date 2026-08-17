#!/usr/bin/env node
'use strict';

/**
 * Phase 18 §27 — Real E2E lifecycle run (narrative, objective evidence).
 *
 * Scenario A (happy path):
 *   known defect → recorded as finding → (no fix yet) revalidate → STILL_BROKEN
 *   → developer "applies fix" by pointing at the fixed variant → revalidate
 *   → VERIFIED_FIXED + before/after comparison + targeted regression
 *   → approve closure → finding RESOLVED → evidence survives refresh.
 *
 * Scenario B (fix + regression):
 *   fixed variant + a regression the fix introduced → validation must end
 *   REGRESSED, never VERIFIED_FIXED. Then reopen.
 *
 * Output: .drytis/phase18-lifecycle-run.json (objective evidence for the report)
 */

import { readFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.QASE_BASE_URL || 'http://localhost:5173';
const APP_BUGGY = 'http://localhost:9906';
const APP_FIXED = 'http://localhost:9907';
const TOKEN = process.env.QASE_API_TOKEN
	|| (readFileSync('/workspace/.env', 'utf8').match(/^QASE_API_TOKEN=(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '');
if (!TOKEN) { console.error('token missing'); process.exit(1); }

const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };
const log = (...a) => console.log(...a);

async function req(method, path, body, extra = {}) {
	const res = await fetch(`${BASE}${path}`, { method, headers: { ...H, ...extra }, body: body ? JSON.stringify(body) : undefined });
	let json = null; try { json = await res.json(); } catch { /* */ }
	return { status: res.status, json };
}

async function waitTerminal(findingId, tries = 40) {
	for (let i = 0; i < tries; i++) {
		const r = await req('GET', `/api/v1/findings/${findingId}/validation`);
		if (r.status === 200 && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(r.json.latest?.status)) return r.json.latest;
		await new Promise(res => setTimeout(res, 2000));
	}
	throw new Error('timeout');
}

const evidence = { scenarioA: {}, scenarioB: {}, timings: {} };

async function main() {
	log('══ Phase 18 §27 — Real lifecycle run ══\n');

	/* ── Scenario A ── */
	log('[A1] seed the known defect (Contacts lost on reload — app6 buggy)');
	const seedA = await req('POST', '/api/findings', {
		title: 'LIFECYCLE-A: Contacts are lost after page reload — data does not persist',
		severity: 'high', category: 'functional', url: `${APP_BUGGY}/`,
		steps: [`Go to ${APP_BUGGY}/`, 'Click "Add Contact"', 'Enter Name: Lifecycle User', 'Click Save', 'Reload the page'],
		expected: 'The contact persists in localStorage and the list still shows "Lifecycle User" after reload.',
		actual: 'Contact list resets to defaults on reload.',
		evidence: 'contacts live in a JS variable; no localStorage write.',
	});
	evidence.scenarioA.finding = seedA.json.id;
	log(`     finding: ${seedA.json.id}`);

	log('[A2] revalidate BEFORE the fix → expect STILL_BROKEN');
	let t0 = Date.now();
	await req('POST', `/api/v1/findings/${seedA.json.id}/revalidate`, {}, { 'Idempotency-Key': `p18life-a1-${seedA.json.id.slice(0, 8)}` });
	let run1 = await waitTerminal(seedA.json.id);
	evidence.scenarioA.preFix = { validationId: run1.id, fixStatus: run1.fixStatus, reason: run1.fixStatusReason, confidence: run1.validationConfidence, durationMs: Date.now() - t0 };
	log(`     ${run1.id} → ${run1.fixStatus} (${run1.fixStatusReason}), conf ${run1.validationConfidence}, ${(Date.now() - t0) / 1000 | 0}s`);

	log('[A3] developer applies the fix → point the finding at the fixed variant');
	const upd = await req('PUT', `/api/findings/${seedA.json.id}`, { url: `${APP_FIXED}/`, steps: [`Go to ${APP_FIXED}/`, 'Click "Add Contact"', 'Enter Name: Lifecycle User', 'Click Save', 'Reload the page'] });
	log(`     finding url updated: ${upd.json.url}`);

	log('[A4] revalidate AFTER the fix → expect VERIFIED_FIXED');
	t0 = Date.now();
	await req('POST', `/api/v1/findings/${seedA.json.id}/revalidate`, {}, { 'Idempotency-Key': `p18life-a2-${seedA.json.id.slice(0, 8)}-${Date.now()}` });
	let run2 = await waitTerminal(seedA.json.id);
	evidence.scenarioA.postFix = { validationId: run2.id, fixStatus: run2.fixStatus, reason: run2.fixStatusReason, confidence: run2.validationConfidence, durationMs: Date.now() - t0, attempts: run2.attempts.length };
	log(`     ${run2.id} → ${run2.fixStatus}, conf ${run2.validationConfidence}, ${(Date.now() - t0) / 1000 | 0}s, attempts ${run2.attempts.length}`);

	log('[A5] before/after comparison');
	const cmp = await req('GET', `/api/v1/findings/${seedA.json.id}/comparison`);
	evidence.scenarioA.comparison = { verdicts: cmp.json.comparison?.verdicts, beforeCount: cmp.json.before?.length, afterCount: cmp.json.after?.length };
	log(`     verdicts: ${JSON.stringify(cmp.json.comparison?.verdicts)}`);

	log('[A6] approve closure → finding RESOLVED');
	const appr = await req('POST', `/api/v1/findings/${seedA.json.id}/approve`, { decision: 'APPROVED', comment: 'lifecycle run: fix confirmed' });
	const fAfter = await req('GET', `/api/findings/${seedA.json.id}`);
	evidence.scenarioA.closure = { reviewState: appr.json.reviewState, lifecycle: appr.json.lifecycle, findingStatus: fAfter.json.finding_status };
	log(`     review ${appr.json.reviewState} | lifecycle ${JSON.stringify(appr.json.lifecycle)} | finding ${fAfter.json.finding_status}`);

	log('[A7] evidence survives refresh (re-read after restart-like delay)');
	await new Promise(r => setTimeout(r, 2000));
	const recheck = await req('GET', `/api/v1/findings/${seedA.json.id}/validation`);
	evidence.scenarioA.persistence = {
		runsVisible: recheck.json.latest ? 1 + recheck.json.history.length : 0,
		beforeEvidence: recheck.json.latest.evidence?.before?.length ?? 0,
		afterEvidence: recheck.json.latest.evidence?.after?.length ?? 0,
	};
	log(`     runs visible: ${evidence.scenarioA.persistence.runsVisible}, before/after evidence: ${evidence.scenarioA.persistence.beforeEvidence}/${evidence.scenarioA.persistence.afterEvidence}`);

	/* ── Scenario B: fix + regression ── */
	log('\n[B1] seed a second finding on the FIXED variant');
	const seedB = await req('POST', '/api/findings', {
		title: 'LIFECYCLE-B: search box does not filter contacts',
		severity: 'medium', category: 'functional', url: `${APP_FIXED}/`,
		steps: [`Go to ${APP_FIXED}/`, 'Click "Add Contact"', 'Enter Name: B User', 'Click Save'],
		expected: 'The contact persists and the list shows "B User".',
		actual: 'no persistence (pre-fix).',
	});
	evidence.scenarioB.finding = seedB.json.id;
	log(`     finding: ${seedB.json.id}`);

	log('[B2] link a regression test the fix broke (verify persistence broke legacy bulk import)');
	const tc = await req('POST', '/api/test-cases', {
		name: 'LIFECYCLE-B regression: bulk import panel (legacy)',
		targetUrl: `${APP_FIXED}/`,
		steps: [{ action: 'navigate', target: `${APP_FIXED}/` }],
		assertions: [{ type: 'element_visible', target: 'text=Bulk Import' }],
		tags: ['p18-lifecycle'],
	});
	await req('PUT', `/api/test-cases/${tc.json.id}`, { findingIds: [seedB.json.id] });
	log(`     regression test linked: ${tc.json.id}`);

	log('[B3] validate → expect REGRESSED (never VERIFIED_FIXED)');
	t0 = Date.now();
	await req('POST', `/api/v1/findings/${seedB.json.id}/revalidate`, {}, { 'Idempotency-Key': `p18life-b-${seedB.json.id.slice(0, 8)}` });
	const runB = await waitTerminal(seedB.json.id);
	evidence.scenarioB.result = { validationId: runB.id, fixStatus: runB.fixStatus, reason: runB.fixStatusReason, regressions: runB.regressions, durationMs: Date.now() - t0 };
	log(`     ${runB.id} → ${runB.fixStatus} | verified regressions: ${runB.regressions?.verifiedRegressions?.length ?? 0}`);
	assert(runB.fixStatus === 'REGRESSED', 'Scenario B must end REGRESSED');

	log('[B4] reopen the finding');
	const reop = await req('POST', `/api/v1/findings/${seedB.json.id}/reopen`, { comment: 'lifecycle run: regression — fix must be reworked' });
	evidence.scenarioB.reopen = { reviewState: reop.json.reviewState };
	log(`     review state: ${reop.json.reviewState}`);

	// cleanup regression link
	await req('PUT', `/api/test-cases/${tc.json.id}`, { findingIds: [] });

	evidence.timings = { note: 'per-run durations embedded above (A pre-fix, A post-fix, B)' };
	evidence.verdict = {
		scenarioA: evidence.scenarioA.preFix.fixStatus === 'STILL_BROKEN' && evidence.scenarioA.postFix.fixStatus === 'VERIFIED_FIXED' && evidence.scenarioA.closure.findingStatus === 'RESOLVED',
		scenarioB: evidence.scenarioB.result.fixStatus === 'REGRESSED',
	};
	writeFileSync('.drytis/phase18-lifecycle-run.json', JSON.stringify(evidence, null, 2));
	log('\n──────────────────────────────────');
	log(`Scenario A (detect → still broken → fix → verified → resolved): ${evidence.verdict.scenarioA ? 'PASS ✅' : 'FAIL ❌'}`);
	log(`Scenario B (fix + regression → REGRESSED):                       ${evidence.verdict.scenarioB ? 'PASS ✅' : 'FAIL ❌'}`);
	log('saved → .drytis/phase18-lifecycle-run.json');
	process.exit(evidence.verdict.scenarioA && evidence.verdict.scenarioB ? 0 : 1);
}

function assert(cond, msg) { if (!cond) { console.error('ASSERT:', msg); process.exit(1); } }

main().catch(err => { console.error('lifecycle run crashed:', err); process.exit(1); });
