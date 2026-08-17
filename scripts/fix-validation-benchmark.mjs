#!/usr/bin/env node
'use strict';

/**
 * Phase 18 — Fix Validation Benchmark (10 scenarios, deterministic, no LLM).
 *
 * Scenarios (spec §26):
 *   1. completely_fixed        → expect VERIFIED_FIXED
 *   2. still_broken            → expect STILL_BROKEN
 *   3. partially_fixed         → expect PARTIALLY_FIXED
 *   4. fixed_with_regression   → expect REGRESSED (never VERIFIED_FIXED)
 *   5. intermittent            → expect UNABLE_TO_VERIFY
 *   6. environment_mismatch    → expect UNABLE_TO_VERIFY (no decisive observation)
 *   7. insufficient_evidence   → expect UNABLE_TO_VERIFY (evidence_insufficient)
 *   8. ux_fixed                → expect VERIFIED_FIXED
 *   9. api_fixed               → expect VERIFIED_FIXED
 *  10. mobile_fixed            → expect VERIFIED_FIXED
 *
 * Scenarios 1–2 exercise the FULL executor (real browser via replay) against
 * ContactVault variants: app6 (bug present → STILL_BROKEN) and app7 (fixed
 * → VERIFIED_FIXED). Scenarios 3–10 exercise classifyFixStatus determinism
 * plus evidence-sufficiency and comparison shaping on synthetic runs, and
 * scenario 4 additionally exercises the full executor with a regression test
 * linked to the finding.
 *
 * Metrics: fix verification accuracy, false-fixed rate, still-broken accuracy,
 * partial-fix accuracy, regression detection, unable-to-verify accuracy,
 * evidence completeness.
 * Targets: accuracy ≥90%, false-fixed ≤5%, regression detection ≥90%,
 * evidence completeness ≥95%.
 *
 * Usage: node scripts/fix-validation-benchmark.mjs [--host http://localhost:5173]
 */

import { readFileSync } from 'node:fs';

/* ── Config ── */
const HOST = process.argv.includes('--host')
	? process.argv[process.argv.indexOf('--host') + 1]
	: 'http://localhost:5173';
const envToken = (() => {
	try { return (readFileSync('/workspace/.env', 'utf8').match(/^QASE_API_TOKEN=(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, ''); } catch { return ''; }
})();
const TOKEN = process.env.QASE_API_TOKEN || envToken;

/* Benchmark app servers (scripts/serve-benchmarks.py + ContactVault pair) */
const APP_BUGGY = process.env.P18_APP_BUGGY || 'http://localhost:9906';
const APP_FIXED = process.env.P18_APP_FIXED || 'http://localhost:9907';

if (!TOKEN) { console.error('QASE_API_TOKEN required'); process.exit(1); }

const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };
async function req(method, path, body, extra = {}) {
	const res = await fetch(`${HOST}${path}`, { method, headers: { ...H, ...extra }, body: body ? JSON.stringify(body) : undefined });
	let json = null; try { json = await res.json(); } catch { /* no body */ }
	return { status: res.status, json };
}
async function up(url) { try { const r = await fetch(url); return r.ok; } catch { return false; } }

/* ── Scenario bookkeeping ── */
const results = [];
const expect = (name, got, want) => {
	const pass = got === want;
	results.push({ name, expected: want, got, pass });
	console.log(`${pass ? '✅' : '❌'} ${name}: got ${got} expected ${want}`);
	return pass;
};

function evidenceCompleteness(run) {
	// A run is evidence-complete when before + after sides are populated,
	// attempts carry assertion detail, and a comparison block exists.
	if (!run) return 0;
	let score = 0;
	if ((run.evidence?.before ?? []).length > 0) score += 0.25;
	if ((run.evidence?.after ?? []).length > 0) score += 0.25;
	if ((run.attempts ?? []).every(a => Array.isArray(a.assertions) || a.executed !== undefined) && (run.attempts ?? []).length > 0) score += 0.25;
	if (run.comparison && run.comparison.verdicts) score += 0.25;
	return score;
}

async function startValidation(findingId, idem) {
	const r = await req('POST', `/api/v1/findings/${findingId}/revalidate`, {}, idem ? { 'Idempotency-Key': idem } : {});
	if (r.status === 409) {
		// A previous active run is still recorded — wait for it and use it.
		return r.json.validationId;
	}
	if (r.status !== 202 && r.status !== 200) throw new Error(`revalidate ${r.status}: ${JSON.stringify(r.json)}`);
	return r.json.validationId ?? r.json.run?.id;
}

async function waitForRun(findingId, validationId, { tries = 60, delayMs = 1500 } = {}) {
	for (let i = 0; i < tries; i++) {
		const r = await req('GET', `/api/v1/findings/${findingId}/validation`);
		if (process.env.P18_DEBUG && i % 5 === 0) console.log(`   [poll ${i}] status=${r.status} body=${JSON.stringify(r.json).slice(0, 120)}`);
		if (r.status === 200) {
			// Accept the named run OR the latest run for the finding (a prior
			// run for this finding may still be the latest visible one briefly).
			const latest = r.json.latest;
			if (latest && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(latest.status)
				&& (latest.id === validationId || i >= 8)) {
				return latest;
			}
		}
		await new Promise(r2 => setTimeout(r2, delayMs));
	}
	throw new Error(`validation ${validationId} did not complete in time`);
}

/* ── Engine-level (deterministic) scenario harness ── */
async function engineScenario(name, outcome, expected, extraCheck = null) {
	const { classifyFixStatus, aggregateAttempts } = await import('../server/fixStatusEngine.js');
	const c = classifyFixStatus(outcome);
	const agg = aggregateAttempts(outcome.attempts ?? []);
	let pass = expect(name, c.status, expected);
	if (extraCheck) pass = extraCheck(c, agg) && pass;
	return { classified: c, aggregated: agg };
}

async function main() {
	console.log(`Phase 18 Fix Validation Benchmark — ${HOST}`);
	console.log(`apps: buggy=${APP_BUGGY} fixed=${APP_FIXED}\n`);

	const appsUp = (await up(APP_BUGGY)) && (await up(APP_FIXED));
	if (!appsUp) {
		console.error('Benchmark apps not reachable (9906/9907). Serve .drytis/benchmarks/app6+app7 first.');
		process.exit(1);
	}

	/* ── Seed findings via the public API (full-stack path) ── */
	const seed = async (payload) => {
		const r = await req('POST', '/api/findings', payload);
		if (r.status !== 201) throw new Error(`seed failed ${r.status}: ${JSON.stringify(r.json)}`);
		return r.json;
	};

	// Scenario 2 finding: contacts lost on reload (bug present on app6).
	const fStillBroken = await seed({
		title: 'Contacts are lost after page reload — data does not persist',
		severity: 'high',
		category: 'functional',
		url: `${APP_BUGGY}/`,
		steps: [`Go to ${APP_BUGGY}/`, 'Click "Add Contact"', 'Enter Name: Bench User', 'Click Save', 'Reload the page'],
		expected: 'The contact persists in localStorage and the list still shows "Bench User" after reload.',
		actual: 'The contact list resets to the three default contacts; the added contact is gone.',
		evidence: 'contacts live in a JS variable; no localStorage write observed.',
	});

	// Scenario 1 finding: same defect, validated against the FIXED app7.
	const fFixed = await seed({
		title: 'Contacts are lost after page reload — data does not persist',
		severity: 'high',
		category: 'functional',
		url: `${APP_FIXED}/`,
		steps: [`Go to ${APP_FIXED}/`, 'Click "Add Contact"', 'Enter Name: Bench User', 'Click Save', 'Reload the page'],
		expected: 'The contact persists in localStorage and the list still shows "Bench User" after reload.',
		actual: 'Contact list resets to defaults on reload (pre-fix behavior).',
		evidence: 'pre-fix: JS variable only.',
	});

	/* ═══ Scenario 2: STILL_BROKEN (full executor, real browser) ═══ */
	{
		const vid = await startValidation(fStillBroken.id, `p18-bench-s2-${fStillBroken.id.slice(0, 8)}`);
		const run = await waitForRun(fStillBroken.id, vid);
		expect('S2 still_broken', run.fixStatus, 'STILL_BROKEN');
		results.push({ name: 'S2 evidence', completeness: evidenceCompleteness(run) });
	}

	/* ═══ Scenario 1: VERIFIED_FIXED (full executor, real browser) ═══ */
	{
		const vid = await startValidation(fFixed.id, `p18-bench-s1-${fFixed.id.slice(0, 8)}`);
		const run = await waitForRun(fFixed.id, vid);
		expect('S1 completely_fixed', run.fixStatus, 'VERIFIED_FIXED');
		results.push({ name: 'S1 evidence', completeness: evidenceCompleteness(run) });
		results.push({ name: 'S1 confidence', confidence: run.validationConfidence });
	}

	/* ═══ Scenario 4: fixed with regression (engine + linked regression test) ═══ */
	{
		// Create a regression test linked to the fixed finding that FAILS on app7:
		// it expects an element that does not exist there.
		const tc = await req('POST', '/api/test-cases', {
			name: 'Regression: legacy bulk-import panel still available',
			targetUrl: `${APP_FIXED}/`,
			steps: [{ action: 'navigate', target: `${APP_FIXED}/` }],
			assertions: [{ type: 'element_visible', target: 'text=Bulk Import Contacts' }],
			tags: ['p18-bench'],
		});
		if (tc.status !== 201) throw new Error('regression test seed failed');
		await req('PUT', `/api/test-cases/${tc.json.id}`, { findingIds: [fFixed.id] });
		// Re-run validation — the linked failing regression must downgrade REGRESSED.
		const vid = await startValidation(fFixed.id, `p18-bench-s4-${fFixed.id.slice(0, 8)}`);
		const run = await waitForRun(fFixed.id, vid);
		expect('S4 fixed_with_regression', run.fixStatus, 'REGRESSED');
		results.push({ name: 'S4 evidence', completeness: evidenceCompleteness(run) });
		// cleanup link so later runs are unaffected
		await req('PUT', `/api/test-cases/${tc.json.id}`, { findingIds: [] });
	}

	/* ═══ Deterministic engine scenarios (3, 5–10) ═══ */
	const A = (succeeded, sufficient = true) => ({ succeeded, sufficient });

	await engineScenario('S3 partially_fixed', {
		originalFailureReproduced: true,
		expectedObserved: false,
		subConditions: [
			{ id: 'name', label: 'profile name updates', fixed: true },
			{ id: 'photo', label: 'profile photo uploads', fixed: false },
		],
		attempts: [A(false), A(false)], evidenceSufficient: true, environmentMismatch: false,
	}, 'PARTIALLY_FIXED');

	await engineScenario('S5 intermittent', {
		originalFailureReproduced: false,
		expectedObserved: true,
		attempts: [A(true), A(false), A(true)], evidenceSufficient: true, environmentMismatch: false,
	}, 'UNABLE_TO_VERIFY', (c) => c.reason === 'intermittent_attempts');

	await engineScenario('S6 environment_mismatch', {
		originalFailureReproduced: null,
		expectedObserved: null,
		attempts: [], evidenceSufficient: false, environmentMismatch: true,
	}, 'UNABLE_TO_VERIFY', (c) => c.reason === 'environment_mismatch');

	await engineScenario('S7 insufficient_evidence', {
		originalFailureReproduced: false,
		expectedObserved: true,
		attempts: [A(true, false)], evidenceSufficient: false, environmentMismatch: false,
	}, 'UNABLE_TO_VERIFY', (c) => c.reason === 'evidence_insufficient');

	await engineScenario('S8 ux_fixed', {
		originalFailureReproduced: false,
		expectedObserved: true,
		attempts: [A(true), A(true)], evidenceSufficient: true, environmentMismatch: false,
	}, 'VERIFIED_FIXED');

	await engineScenario('S9 api_fixed', {
		originalFailureReproduced: false,
		expectedObserved: true,
		attempts: [A(true), A(true)], evidenceSufficient: true, environmentMismatch: false,
	}, 'VERIFIED_FIXED');

	await engineScenario('S10 mobile_fixed', {
		originalFailureReproduced: false,
		expectedObserved: true,
		attempts: [A(true), A(true), A(true)], evidenceSufficient: true, environmentMismatch: false,
	}, 'VERIFIED_FIXED');

	/* ── Metrics ── */
	const scenarioResults = results.filter(r => r.expected !== undefined);
	const fullRuns = results.filter(r => r.completeness !== undefined);
	const passCount = scenarioResults.filter(r => r.pass).length;
	const fixAcc = passCount / scenarioResults.length;
	const falseFixed = scenarioResults.filter(r => r.name.includes('fixed') && !r.pass && r.got === 'VERIFIED_FIXED').length;
	const stillBrokenOk = results.find(r => r.name === 'S2 still_broken')?.pass ?? false;
	const partialOk = results.find(r => r.name === 'S3 partially_fixed')?.pass ?? false;
	const regressedOk = results.find(r => r.name === 'S4 fixed_with_regression')?.pass ?? false;
	const unableOk = ['S5 intermittent', 'S6 environment_mismatch', 'S7 insufficient_evidence'].every(n => results.find(r => r.name === n)?.pass);
	const regDetectionRate = regressedOk ? 1 : 0;
	const evidenceCompletenessRate = fullRuns.length
		? fullRuns.reduce((s, r) => s + r.completeness, 0) / fullRuns.length : 0;

	const summary = {
		scenarios: scenarioResults.length,
		passed: passCount,
		fixVerificationAccuracy: Number((passCount / scenarioResults.length).toFixed(3)),
		falseFixedRate: Number((falseFixed / scenarioResults.length).toFixed(3)),
		stillBrokenAccuracy: stillBrokenOk ? 1 : 0,
		partialFixAccuracy: partialOk ? 1 : 0,
		regressionDetection: regDetectionRate,
		unableToVerifyAccuracy: ['S5', 'S6', 'S7'].filter(p => results.find(r => r.name.startsWith(p))?.pass).length / 3,
		evidenceCompleteness: Number(evidenceCompletenessRate.toFixed(3)),
		targets: { fixVerificationAccuracy: 0.9, falseFixedRate: 0.05, regressionDetection: 0.9, evidenceCompleteness: 0.95 },
		targetsMet: {
			fixVerificationAccuracy: fixAcc >= 0.9,
			falseFixedRate: (falseFixed / scenarioResults.length) <= 0.05,
			regressionDetection: regDetectionRate >= 0.9,
			evidenceCompleteness: evidenceCompletenessRate >= 0.95,
		},
	};

	console.log('\n──────────────────────────────────────');
	console.log(JSON.stringify(summary, null, 2));

	const allMet = Object.values(summary.targetsMet).every(Boolean);
	console.log(`\nBENCHMARK ${allMet ? 'PASS' : 'FAIL'}`);
	process.exit(allMet ? 0 : 1);
}

main().catch(err => { console.error('benchmark crashed:', err); process.exit(1); });
