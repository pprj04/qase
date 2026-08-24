'use strict';

/**
 * Phase 18 — Autonomous Fix Validation API + E2E lifecycle tests.
 * Run: node --test tests/phase18-e2e.test.js
 *
 * Requires QASE_BASE_URL server (default http://localhost:5173) with
 * QASE_API_TOKEN set, plus the ContactVault benchmark pair on :9906/:9907
 * (scripts/serve-benchmarks.py).
 *
 * 10 cases per spec §25:
 *  1. seed known bug → validate → STILL_BROKEN (developer has NOT fixed)
 *  2. fixed variant → validate → VERIFIED_FIXED (developer fixed)
 *  3. validation confidence is a new measurement (present, separate from finding confidence)
 *  4. structured comparison before/after exists with verdicts
 *  5. attempts recorded with attempts/successful/failed + reproductionRate
 *  6. evidence survives refresh (history endpoint still returns both runs)
 *  7. duplicate validation request (idempotency) does not start a second run
 *  8. approve closure → review trail + lifecycle RESOLVED
 *  9. introduce regression (linked failing test) → REGRESSED not VERIFIED_FIXED
 * 10. reopen → review state REOPENED (human-only state machine)
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = process.env.QASE_BASE_URL || 'http://localhost:5173';
const APP_BUGGY = process.env.P18_APP_BUGGY || 'http://localhost:9906';
const APP_FIXED = process.env.P18_APP_FIXED || 'http://localhost:9907';
const envToken = (() => {
	try { return (readFileSync('/workspace/.env', 'utf8').match(/^QASE_API_TOKEN=(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, ''); } catch { return ''; }
})();
const TOKEN = process.env.QASE_API_TOKEN || envToken;

if (!TOKEN) {
	console.error('QASE_API_TOKEN must be set (export or /workspace/.env)');
	process.exit(1);
}

const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

async function req(method, path, body, extra = {}) {
	const res = await fetch(`${BASE}${path}`, { method, headers: { ...H, ...extra }, body: body ? JSON.stringify(body) : undefined });
	let json = null; try { json = await res.json(); } catch { /* no body */ }
	return { status: res.status, json };
}

async function seedFinding(url) {
	const r = await req('POST', '/api/findings', {
		title: 'E2E: Contacts are lost after page reload — data does not persist',
		severity: 'high',
		category: 'functional',
		url,
		steps: [`Go to ${url}/`, 'Click "Add Contact"', 'Enter Name: E2E User', 'Click Save', 'Reload the page'],
		expected: 'The contact persists in localStorage and the list still shows "E2E User" after reload.',
		actual: 'The contact list resets to defaults; the added contact is gone.',
		evidence: 'contacts live in a JS variable; no localStorage write observed.',
	});
	assert.equal(r.status, 201, `seed failed: ${JSON.stringify(r.json)}`);
	return r.json;
}

async function startValidation(findingId, key) {
	const r = await req('POST', `/api/v1/findings/${findingId}/revalidate`, {}, key ? { 'Idempotency-Key': key } : {});
	assert.ok(r.status === 202 || r.status === 200 || r.status === 409, `revalidate: ${r.status} ${JSON.stringify(r.json)}`);
	return r.json.validationId ?? r.json.run?.id ?? null;
}

async function waitForRun(findingId, { tries = 40, delayMs = 2000 } = {}) {
	for (let i = 0; i < tries; i++) {
		const r = await req('GET', `/api/v1/findings/${findingId}/validation`);
		if (r.status === 200 && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(r.json.latest?.status)) return r.json;
		await new Promise(res => setTimeout(res, delayMs));
	}
	throw new Error('validation did not complete');
}

describe('Phase 18 E2E — fix validation lifecycle', () => {
	let fBuggy = null, fFixed = null;
	let runBuggy = null, runFixed = null;

	before(async () => {
		fBuggy = await seedFinding(APP_BUGGY);
		fFixed = await seedFinding(APP_FIXED);
	});

	after(async () => {
		// cleanup seeded findings (best effort)
		for (const f of [fBuggy, fFixed]) {
			if (f?.id) await req('DELETE', `/api/findings/${f.id}`);
		}
	});

	test('E2E-1: known bug on buggy variant → STILL_BROKEN', async () => {
		await startValidation(fBuggy.id, `p18e2e-buggy-${fBuggy.id.slice(0, 8)}`);
		const data = await waitForRun(fBuggy.id);
		runBuggy = data.latest;
		assert.equal(runBuggy.fixStatus, 'STILL_BROKEN');
		assert.equal(runBuggy.status, 'COMPLETED');
		assert.ok(runBuggy.validationConfidence !== undefined);
	});

	test('E2E-2: fixed variant → VERIFIED_FIXED with new-measurement confidence', async () => {
		await startValidation(fFixed.id, `p18e2e-fixed-${fFixed.id.slice(0, 8)}`);
		const data = await waitForRun(fFixed.id);
		runFixed = data.latest;
		assert.equal(runFixed.fixStatus, 'VERIFIED_FIXED');
		// Confidence is a NEW measurement from validation evidence — for the
		// fixed variant with clean signals it must be high, and must differ in
		// kind from the finding's own confidence field.
		assert.ok(runFixed.validationConfidence >= 0.7, `conf ${runFixed.validationConfidence}`);
		assert.notEqual(runFixed.validationConfidence, fFixed.confidence ?? 0.57);
	});

	test('E2E-3: comparison exists with 4 verdicts (before/after)', async () => {
		const r = await req('GET', `/api/v1/findings/${fFixed.id}/comparison`);
		assert.equal(r.status, 200);
		const cmp = r.json;
		assert.ok(Array.isArray(cmp.before) && cmp.before.length > 0);
		assert.ok(Array.isArray(cmp.after) && cmp.after.length > 0);
		assert.ok(cmp.comparison?.verdicts);
		for (const v of ['behaviorChanged', 'expectedAchieved', 'originalFailureReproduced', 'relatedFailuresIntroduced']) {
			assert.ok(typeof cmp.comparison.verdicts[v] === 'boolean', v);
		}
		assert.equal(cmp.comparison.verdicts.expectedAchieved, true);
		assert.equal(cmp.comparison.verdicts.originalFailureReproduced, false);
	});

	test('E2E-4: attempts recorded with per-attempt detail', async () => {
		assert.ok(Array.isArray(runFixed.attempts) && runFixed.attempts.length >= 2);
		for (const a of runFixed.attempts) {
			assert.ok(a.attempt >= 1);
			assert.ok(typeof a.succeeded === 'boolean');
			assert.ok(typeof a.executed === 'boolean');
			assert.ok(typeof a.sufficiency === 'boolean');
		}
	});

	test('E2E-5: evidence survives — history endpoint returns the run', async () => {
		const r = await req('GET', `/api/v1/findings/${fFixed.id}/validation`);
		assert.equal(r.status, 200);
		assert.equal(r.json.latest.id, runFixed.id);
		assert.ok((r.json.latest.evidence?.before ?? []).length > 0);
		assert.ok((r.json.latest.evidence?.after ?? []).length > 0);
	});

	test('E2E-6: idempotent duplicate request does not start a second run', async () => {
		const key = `p18e2e-idem-${fFixed.id.slice(0, 8)}`;
		const first = await req('POST', `/api/v1/findings/${fFixed.id}/revalidate`, {}, { 'Idempotency-Key': key });
		const second = await req('POST', `/api/v1/findings/${fFixed.id}/revalidate`, {}, { 'Idempotency-Key': key });
		if (first.status === 202 && second.status === 200) {
			assert.equal(second.json.duplicate, true);
			assert.equal(second.json.validationId, first.json.validationId);
			// and the store must not have gained a second run for this key
			const r = await req('GET', `/api/v1/findings/${fFixed.id}/validation`);
			assert.ok(r.json.latest.id === first.json.validationId);
		} else {
			// 409 active-run guard — also acceptable idempotent behavior: no dup run.
			assert.ok(first.status === 409 || second.status === 409);
		}
	});

	test('E2E-7: approve closure → RESOLVED lifecycle + review trail', async () => {
		const r = await req('POST', `/api/v1/findings/${fFixed.id}/approve`, { decision: 'APPROVED', comment: 'e2e approve' });
		assert.equal(r.status, 200);
		assert.equal(r.json.reviewState, 'APPROVED');
		assert.ok(r.json.reviewTrail?.length >= 1);
		// finding lifecycle must now be RESOLVED
		const f = await req('GET', `/api/findings/${fFixed.id}`);
		assert.equal(f.json.finding_status, 'RESOLVED');
	});

	test('E2E-8: reopen after approval → REOPENED review state', async () => {
		const r = await req('POST', `/api/v1/findings/${fFixed.id}/reopen`, { comment: 'e2e reopen' });
		assert.equal(r.status, 200);
		assert.equal(r.json.reviewState, 'REOPENED');
		// finding reopened too
		const f = await req('GET', `/api/findings/${fFixed.id}`);
		assert.equal(f.json.finding_status, 'REOPENED');
	});

	test('E2E-9: regression scenario — VERIFIED_FIXED must become REGRESSED', async () => {
		// Link a failing regression test to the FIXED finding, then revalidate.
		const tc = await req('POST', '/api/test-cases', {
			name: 'E2E regression probe: nonexistent element',
			targetUrl: `${APP_FIXED}/`,
			steps: [{ action: 'navigate', target: `${APP_FIXED}/` }],
			assertions: [{ type: 'element_visible', target: 'text=Not Present Anywhere' }],
			tags: ['p18-e2e'],
		});
		assert.equal(tc.status, 201);
		await req('PUT', `/api/test-cases/${tc.json.id}`, { findingIds: [fFixed.id] });

		// finding was REOPENED — a new validation may start
		await startValidation(fFixed.id, `p18e2e-reg-${fFixed.id.slice(0, 8)}-${Date.now()}`);
		const data = await waitForRun(fFixed.id);
		const run = data.latest;
		// The regression test fails deterministically → REGRESSED, never VERIFIED_FIXED
		assert.equal(run.fixStatus, 'REGRESSED');
		assert.ok(run.regressions?.hasVerifiedRegression === true);
		await req('PUT', `/api/test-cases/${tc.json.id}`, { findingIds: [] });
	});

	test('E2E-10: original finding snapshot is immutable in the run', async () => {
		const r = await req('GET', `/api/v1/findings/${fBuggy.id}/validation`);
		const snap = r.json.latest.originalFinding;
		assert.equal(snap.id, fBuggy.id);
		assert.equal(snap.title, fBuggy.title);
		assert.equal(snap.expected, fBuggy.expected);
		// mutating the live finding later must NOT change the snapshot
		await req('PUT', `/api/findings/${fBuggy.id}`, { title: 'MUTATED TITLE' });
		const r2 = await req('GET', `/api/v1/findings/${fBuggy.id}/validation`);
		assert.equal(r2.json.latest.originalFinding.title, fBuggy.title);
	});
});
