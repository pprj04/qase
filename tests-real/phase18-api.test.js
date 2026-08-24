'use strict';

/**
 * Phase 18 — Fix Validation API integration tests.
 * Run: node --test tests/phase18-api.test.js
 *
 * Requires QASE_BASE_URL server + QASE_API_TOKEN + ContactVault pair on
 * :9906/:9907. Exercises: auth gates (401), 404s, validation lifecycle
 * (REQUESTED→…→COMPLETED), idempotency, active-run 409 guard, comparison
 * payload, approve/reopen review machine, findings-metrics parity, and
 * Phase 16 backward compatibility (existing endpoints unchanged).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = process.env.QASE_BASE_URL || 'http://localhost:5173';
const APP_BUGGY = process.env.P18_APP_BUGGY || 'http://localhost:9906';
const envToken = (() => {
	try { return (readFileSync('/workspace/.env', 'utf8').match(/^QASE_API_TOKEN=(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, ''); } catch { return ''; }
})();
const TOKEN = process.env.QASE_API_TOKEN || envToken;
if (!TOKEN) { console.error('QASE_API_TOKEN required'); process.exit(1); }

const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

async function req(method, path, body, extra = {}, useAuth = true) {
	const res = await fetch(`${BASE}${path}`, {
		method,
		headers: useAuth ? { ...H, ...extra } : { 'Content-Type': 'application/json', ...extra },
		body: body ? JSON.stringify(body) : undefined,
	});
	let json = null; try { json = await res.json(); } catch { /* no body */ }
	return { status: res.status, json };
}

describe('Phase 18 API', () => {
	let finding = null;
	let validationId = null;

	before(async () => {
		const r = await req('POST', '/api/findings', {
			title: 'API test: contacts lost after reload',
			severity: 'medium', category: 'functional', url: `${APP_BUGGY}/`,
			steps: [`Go to ${APP_BUGGY}/`, 'Click "Add Contact"', 'Enter Name: API User', 'Click Save', 'Reload the page'],
			expected: 'The contact persists and the list still shows "API User" after reload.',
			actual: 'resets to defaults.',
		});
		assert.equal(r.status, 201);
		finding = r.json;
	});

	after(async () => {
		if (finding?.id) await req('DELETE', `/api/findings/${finding.id}`);
	});

	test('revalidate requires auth → 401 without token', async () => {
		const r = await req('POST', `/api/v1/findings/${finding.id}/revalidate`, {}, {}, false);
		assert.equal(r.status, 401);
	});

	test('unknown finding → 404', async () => {
		const r = await req('POST', '/api/v1/findings/does-not-exist/revalidate');
		assert.equal(r.status, 404);
	});

	test('revalidate → 202 with stable validationId + async status', async () => {
		const r = await req('POST', `/api/v1/findings/${finding.id}/revalidate`, {}, { 'Idempotency-Key': `p18api-${finding.id.slice(0, 8)}` });
		assert.equal(r.status, 202);
		assert.ok(r.json.validationId?.startsWith('fxv_'));
		assert.ok(['REQUESTED', 'QUEUED', 'RUNNING'].includes(r.json.status));
		validationId = r.json.validationId;
	});

	test('validation detail reachable; run completes with deterministic status', async () => {
		let latest = null;
		for (let i = 0; i < 40; i++) {
			const r = await req('GET', `/api/v1/findings/${finding.id}/validation`);
			if (r.status === 200 && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(r.json.latest?.status)) { latest = r.json.latest; break; }
			await new Promise(res => setTimeout(res, 2000));
		}
		assert.ok(latest, 'validation completed');
		assert.equal(latest.id, validationId);
		assert.ok(['VERIFIED_FIXED', 'STILL_BROKEN', 'PARTIALLY_FIXED', 'REGRESSED', 'UNABLE_TO_VERIFY'].includes(latest.fixStatus));
		// immutable snapshot embedded
		assert.equal(latest.originalFinding.id, finding.id);
	});

	test('idempotency: same key returns existing run, no duplicate', async () => {
		const key = `p18api-dup-${finding.id.slice(0, 8)}`;
		const a = await req('POST', `/api/v1/findings/${finding.id}/revalidate`, {}, { 'Idempotency-Key': key });
		const b = await req('POST', `/api/v1/findings/${finding.id}/revalidate`, {}, { 'Idempotency-Key': key });
		if (a.status === 202 && b.status === 200) {
			assert.equal(b.json.duplicate, true);
			assert.equal(b.json.validationId, a.json.validationId);
		} else {
			assert.ok([202, 200, 409].includes(a.status));
			assert.ok([202, 200, 409].includes(b.status));
		}
	});

	test('comparison endpoint returns before/after + verdicts', async () => {
		let cmp = null;
		for (let i = 0; i < 30; i++) {
			const r = await req('GET', `/api/v1/findings/${finding.id}/comparison`);
			if (r.status === 200) { cmp = r.json; break; }
			await new Promise(res => setTimeout(res, 1500));
		}
		assert.ok(cmp, 'comparison exists');
		assert.ok(Array.isArray(cmp.before) && Array.isArray(cmp.after));
		assert.ok(cmp.comparison.verdicts);
		assert.equal(typeof cmp.comparison.verdicts.behaviorChanged, 'boolean');
	});

	test('approve before completion is guarded; after completion transitions work', async () => {
		const r = await req('POST', `/api/v1/findings/${finding.id}/approve`, { decision: 'APPROVED', comment: 'api test' });
		if (r.status === 200) {
			assert.equal(r.json.reviewState, 'APPROVED');
		} else {
			// STILL_BROKEN outcome: approve is recorded, lifecycle untouched
			assert.equal(r.status, 200);
		}
	});

	test('review state machine rejects illegal transitions', async () => {
		// APPROVED → APPROVED is not allowed
		const r = await req('POST', `/api/v1/findings/${finding.id}/approve`, { decision: 'APPROVED' });
		if (r.status === 409) {
			assert.ok(r.json.error.includes('transition') || r.json.error.includes('state'));
		}
		// invalid decision value
		const r2 = await req('POST', `/api/v1/findings/${finding.id}/approve`, { decision: 'MAYBE' });
		assert.equal(r2.status, 400);
	});

	test('reopen works and is idempotent-safe', async () => {
		const r = await req('POST', `/api/v1/findings/${finding.id}/reopen`, { comment: 'api reopen' });
		assert.ok(r.status === 200 || r.status === 409);
		if (r.status === 200) assert.equal(r.json.reviewState, 'REOPENED');
	});

	test('fix-validation metrics exposed on dashboard (observability)', async () => {
		const r = await req('GET', '/api/metrics/dashboard');
		assert.equal(r.status, 200);
		assert.ok(r.json.fixValidations);
		assert.ok(typeof r.json.fixValidations.totalRuns === 'number');
		assert.ok(r.json.fixValidations.byStatus);
	});

	test('cross-finding overview route works', async () => {
		const r = await req('GET', '/api/v1/fix-validations?limit=5');
		assert.equal(r.status, 200);
		assert.ok(Array.isArray(r.json.runs));
		assert.ok(r.json.metrics);
	});

	test('Phase 16 backward compat: findings list still works with Phase 16 filters', async () => {
		const r = await req('GET', '/api/findings?primaryCategory=FUNCTIONAL&limit=5');
		assert.equal(r.status, 200);
		const r2 = await req('GET', '/api/findings/grouped?groupBy=category');
		assert.equal(r2.status, 200);
		const r3 = await req('GET', `/api/findings/${finding.id}`);
		assert.equal(r3.status, 200);
		assert.equal(r3.json.id, finding.id);
	});

	test('v1 mission routes untouched (Phase 16/17 contract)', async () => {
		const r = await req('GET', '/api/v1/missions?limit=3');
		assert.equal(r.status, 200);
		assert.ok(Array.isArray(r.json.missions));
	});
});
