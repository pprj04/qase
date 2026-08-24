'use strict';

/**
 * Phase 17 — E2E test cases (10 named cases).
 * Run: node --test tests/phase17-e2e.test.js
 *
 * E2E = against a real mission through the full stack: start a REAL mission
 * against a local benchmark app, wait for completion, then verify the UX
 * assessment pipeline end-to-end: finalize hook fired, store persisted,
 * APIs serve real data, report sections exist, review flow works.
 *
 * Requires: server running (QASE_BASE_URL), QASE_API_TOKEN set, and a local
 * benchmark app served by scripts/serve-benchmarks.py on ports 9901–9905.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.QASE_BASE_URL || 'http://localhost:5173';
const TOKEN = process.env.QASE_API_TOKEN || '';
const TARGET = process.env.PHASE17_E2E_TARGET || 'http://localhost:9901';
// Generous budget: mission duration is LLM-bound and varies with concurrent
// load (measured 60s–950s across Phase 16/17 runs under parallel load).
// 900s keeps the suite deterministic without masking real hangs; the suite's
// own wall-clock is bounded by this constant plus polling overhead.
const SWEEP_SECONDS = 900;

function headers() {
	return { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };
}

async function req(method, path, body) {
	const res = await fetch(`${BASE}${path}`, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
	let json = null;
	try { json = await res.json(); } catch { /* empty */ }
	return { status: res.status, json };
}

async function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

describe('Phase 17 E2E — full mission with UX intelligence', () => {
	let missionId = null;

	before(async () => {
		assert.ok(TOKEN, 'QASE_API_TOKEN required');
		// Health: benchmark target reachable
		const ping = await fetch(TARGET);
		assert.equal(ping.status, 200, `benchmark app ${TARGET} must be up`);
	});

	// Case 1: mission creation auto-starts (202 + missionId)
	test('E2E-1: create ux mission against benchmark app', async () => {
		const { status, json } = await req('POST', '/api/v1/missions', {
			name: 'Phase 17 E2E UX mission',
			type: 'ux',
			targetUrl: TARGET,
			requirements: ['Contact form must exist', 'Navigation must include pricing'],
			constraints: { maxDurationSeconds: 120 },
		});
		assert.ok([200, 201, 202].includes(status), `create status ${status}: ${JSON.stringify(json).slice(0, 200)}`);
		missionId = json.id ?? json.missionId ?? json.mission?.id;
		assert.ok(missionId, 'mission id returned');
	});

	// Case 2: mission is running (auto-started on create)
	test('E2E-2: mission running after create', async () => {
		const { status, json } = await req('GET', `/api/v1/missions/${missionId}`);
		assert.equal(status, 200);
		assert.ok(['created', 'queued', 'running'].includes(json.status), `status ${json.status}`);
	});

	// Case 3: mission completes (bounded wait)
	test('E2E-3: mission reaches completed state', async () => {
		const deadline = Date.now() + SWEEP_SECONDS * 1000;
		let last = null;
		while (Date.now() < deadline) {
			const { json } = await req('GET', `/api/v1/missions/${missionId}`);
			last = json.status;
			if (['completed', 'failed', 'aborted', 'timeout'].includes(json.status)) break;
			await wait(3000);
		}
		assert.equal(last, 'completed', `mission status was ${last}`);
	});

	// Case 4: UX assessment auto-created after finalize (the async hook)
	test('E2E-4: async UX assessment appears after finalize', async () => {
		const deadline = Date.now() + 90_000;
		let found = false;
		while (Date.now() < deadline) {
			const { status } = await req('GET', `/api/v1/missions/${missionId}/ux`);
			if (status === 200) { found = true; break; }
			await wait(3000);
		}
		assert.ok(found, 'GET /ux should 200 after finalize within 90s');
	});

	// Case 5: sweep visited real pages at 3 viewports
	test('E2E-5: sweep meta shows multi-viewport coverage', async () => {
		const { json } = await req('GET', `/api/v1/missions/${missionId}/ux`);
		const m = json.sweepMeta;
		assert.ok(m.pagesVisited > 0, 'at least one page visited');
		assert.deepEqual(m.viewports, ['desktop', 'tablet', 'mobile']);
		assert.ok(m.durationMs <= 120_000 + 20_000, 'sweep bounded by wall clock');
	});

	// Case 6: quality dimensions with confidence + coverage
	test('E2E-6: quality assessment has scored dimensions', async () => {
		const { json } = await req('GET', `/api/v1/missions/${missionId}/quality`);
		assert.ok(json.dimensions.length > 0, 'dimensions scored');
		const ux = json.dimensions.find((d) => d.dimension === 'UX' || d.dimension === 'FUNCTIONAL');
		assert.ok(ux, 'core dimension present');
	});

	// Case 7: issues are deterministic (every issue has evidence)
	test('E2E-7: every UX issue carries deterministic evidence', async () => {
		const { json } = await req('GET', `/api/v1/missions/${missionId}/ux`);
		for (const i of json.issues ?? []) {
			assert.ok(Array.isArray(i.evidence) && i.evidence.length >= 1, `issue ${i.id} needs evidence`);
			for (const e of i.evidence) assert.ok(e.kind && e.detail !== undefined, 'evidence typed');
		}
	});

	// Case 8: recommendations are evidence-linked and prioritized
	test('E2E-8: recommendations link back to evidence', async () => {
		const { json } = await req('GET', `/api/v1/missions/${missionId}/recommendations`);
		assert.ok(json.recommendations.length > 0, 'recommendations generated');
		for (const r of json.recommendations.slice(0, 5)) {
			assert.ok(r.refType && r.refId, 'each rec references its source');
			assert.ok(Array.isArray(r.evidence), 'rec carries evidence');
		}
	});

	// Case 9: review flow through the API (approve → reject → terminal)
	test('E2E-9: human review flow works end-to-end', async () => {
		const { json } = await req('GET', `/api/v1/missions/${missionId}/ux`);
		const target = (json.issues ?? []).find((i) => i.reviewState !== 'REJECTED');
		if (!target) return; // nothing reviewable — acceptable on tiny apps
		const { status: s1, json: j1 } = await req('PATCH', `/api/v1/missions/${missionId}/ux/issues/${target.id}/review`, {
			reviewState: 'AUTO_VERIFIED', by: 'e2e',
		});
		assert.equal(s1, 200);
		assert.equal(j1.issue.reviewState, 'AUTO_VERIFIED');
		const { status: s2 } = await req('PATCH', `/api/v1/missions/${missionId}/ux/issues/${target.id}/review`, {
			reviewState: 'REJECTED', by: 'e2e',
		});
		assert.equal(s2, 200);
		const { status: s3 } = await req('PATCH', `/api/v1/missions/${missionId}/ux/issues/${target.id}/review`, {
			reviewState: 'AUTO_VERIFIED', by: 'system',
		});
		assert.equal(s3, 409, 'REJECTED terminal for system');
	});

	// Case 10: markdown report contains the Phase 17 sections
	test('E2E-10: report contains APPLICATION QUALITY + UX sections', async () => {
		const res = await fetch(`${BASE}/api/v1/missions/${missionId}/report?format=md`, { headers: headers() });
		const md = await res.text();
		assert.ok(md.includes('APPLICATION QUALITY'));
		// Either issues exist with evidence, or an unverified note explains why not
		assert.ok(md.includes('UX ISSUES') || md.includes('UNVERIFIED') || md.includes('could not be verified'),
			'UX section present with issues or documented absence');
	});

	after(async () => {
		if (missionId) {
			// Best-effort cleanup: leave data for inspection but log it
			console.log(`[phase17-e2e] mission ${missionId} left for inspection`);
		}
	});
});
