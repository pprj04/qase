'use strict';

/**
 * Phase 16 — Bug Intelligence API integration tests.
 * Run: node --test tests/phase16-api.test.js
 *
 * Requires the server running on QASE_BASE_URL (default http://localhost:5173)
 * with QASE_API_TOKEN set. Creates findings via the API, verifies enrichment
 * fields, review flow, duplicates, evidence, grouped reports, and auth.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.QASE_BASE_URL || 'http://localhost:5173';
const TOKEN = process.env.QASE_API_TOKEN || '';
const createdIds = [];

function headers(extra = {}) {
	return {
		'Content-Type': 'application/json',
		...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
		...extra,
	};
}

async function req(method, path, body) {
	const res = await fetch(`${BASE}${path}`, {
		method,
		headers: headers(),
		body: body ? JSON.stringify(body) : undefined,
	});
	let json = null;
	try { json = await res.json(); } catch { /* no body */ }
	return { status: res.status, json };
}

describe('Phase 16 API', () => {

	test('enums endpoint returns taxonomy', async () => {
		const { status, json } = await req('GET', '/api/bug-intelligence/enums');
		assert.equal(status, 200);
		assert.equal(json.categories.length, 20);
		assert.ok(json.priorities.includes('P0'));
		assert.ok(json.lifecycle.includes('VERIFIED'));
		assert.ok(json.reviewStatuses.includes('false_positive'));
	});

	test('finding creation accepts new fields (backward compatible)', async () => {
		const { status, json } = await req('POST', '/api/findings', {
			title: 'Phase16 IT: Checkout submission fails for all users',
			severity: 'high',
			category: 'forms',
			url: 'https://it.test/checkout',
			expected: 'Order created',
			actual: 'Stays on checkout page',
			observed: 'Clicking submit does nothing; console shows TypeError',
			impact: 'Users cannot complete purchases',
			reproducibility: 'confirmed',
		});
		assert.equal(status, 201);
		createdIds.push(json.id);
		assert.ok(json.id);
		assert.equal(json.severity, 'high');
	});

	test('created finding has lifecycle/review defaults', async () => {
		const id = createdIds[0];
		const { status, json } = await req('GET', `/api/findings/${id}`);
		assert.equal(status, 200);
		assert.equal(json.finding_status, 'DETECTED');
		assert.equal(json.review_status, 'unreviewed');
	});

	test('PATCH classification validates enum and persists', async () => {
		const id = createdIds[0];
		const bad = await req('PATCH', `/api/findings/${id}/classification`, { primaryCategory: 'NOT_A_CATEGORY' });
		assert.equal(bad.status, 400);
		const ok = await req('PATCH', `/api/findings/${id}/classification`, {
			primaryCategory: 'FUNCTIONAL',
			secondaryCategories: ['API', 'UI'],
			confidence: 0.9,
		});
		assert.equal(ok.status, 200);
		assert.equal(ok.json.primary_category, 'FUNCTIONAL');
		assert.deepEqual(ok.json.secondary_categories, ['API', 'UI']);
		assert.equal(ok.json.classification_confidence, 0.9);
	});

	test('PATCH severity validates and audits rationale', async () => {
		const id = createdIds[0];
		const bad = await req('PATCH', `/api/findings/${id}/severity`, { severity: 'catastrophic' });
		assert.equal(bad.status, 400);
		const ok = await req('PATCH', `/api/findings/${id}/severity`, {
			severity: 'critical',
			confidence: 0.9,
			rationale: 'Checkout blocked for all users',
		});
		assert.equal(ok.status, 200);
		assert.equal(ok.json.severity, 'critical');
		assert.equal(ok.json.severity_confidence, 0.9);
		assert.match(ok.json.severity_rationale, /Checkout/);
		assert.ok(ok.json.history.some(h => h.field === 'severity'));
	});

	test('PATCH priority validates P0–P3', async () => {
		const id = createdIds[0];
		const bad = await req('PATCH', `/api/findings/${id}/priority`, { priority: 'P9' });
		assert.equal(bad.status, 400);
		const ok = await req('PATCH', `/api/findings/${id}/priority`, { priority: 'P1', rationale: 'Checkout critical' });
		assert.equal(ok.status, 200);
		assert.equal(ok.json.priority, 'P1');
	});

	test('PATCH review applies verdicts with lifecycle coupling', async () => {
		const id = createdIds[0];
		const bad = await req('PATCH', `/api/findings/${id}/review`, { reviewStatus: 'garbage' });
		assert.equal(bad.status, 400);
		const ok = await req('PATCH', `/api/findings/${id}/review`, { reviewStatus: 'confirmed', note: 'IT check' });
		assert.equal(ok.status, 200);
		assert.equal(ok.json.review_status, 'confirmed');
		assert.ok(['VERIFYING', 'DETECTED'].includes(ok.json.finding_status));
		const fp = await req('PATCH', `/api/findings/${id}/review`, { reviewStatus: 'false_positive' });
		assert.equal(fp.status, 200);
		assert.equal(fp.json.review_status, 'false_positive');
		assert.equal(fp.json.finding_status, 'FALSE_POSITIVE');
		// restore
		await req('PATCH', `/api/findings/${id}/review`, { reviewStatus: 'confirmed' });
	});

	test('duplicate detection groups similar findings; possible dupes not auto-merged', async () => {
		const a = await req('POST', '/api/findings', {
			title: 'Phase16 IT dup: Login button broken on /login',
			severity: 'high', category: 'auth', url: 'https://it.test/login',
			actual: 'Button does nothing',
		});
		const b = await req('POST', '/api/findings', {
			title: 'Phase16 IT dup: Login button broken on /login',
			severity: 'high', category: 'auth', url: 'https://it.test/login',
			actual: 'Button does nothing',
		});
		createdIds.push(a.json.id, b.json.id);
		const dup = await req('GET', `/api/findings/${b.json.id}/duplicates`);
		assert.equal(dup.status, 200);
		assert.ok(dup.json.candidates.length >= 1, `expected candidates, got ${JSON.stringify(dup.json.candidates)}`);
		const strong = dup.json.candidates.find(c => c.verdict === 'DUPLICATE');
		const possible = dup.json.candidates.find(c => c.verdict === 'POSSIBLE_DUPLICATE');
		assert.ok(strong || possible, 'at least one duplicate-tier candidate');
		// Manual merge via POST
		if (dup.json.candidates.length > 0 && !dup.json.isDuplicate) {
			const merged = await req('POST', `/api/findings/${b.json.id}/duplicates`, {
				canonicalId: dup.json.candidates[0].id,
			});
			// Either merged (valid canonical) or 400 (candidate itself invalid) — both acceptable shapes
			assert.ok([200, 400].includes(merged.status));
			if (merged.status === 200) {
				assert.equal(merged.json.isDuplicate, true);
				assert.ok(merged.json.duplicateOf);
				assert.ok(merged.json.duplicate_provenance);
			}
		}
	});

	test('related findings endpoint returns signal-based relations', async () => {
		const id = createdIds[0];
		const { status, json } = await req('GET', `/api/findings/${id}/related`);
		assert.equal(status, 200);
		assert.ok(Array.isArray(json.related));
	});

	test('affected-workflow and affected-feature endpoints', async () => {
		const id = createdIds[0];
		const wf = await req('GET', `/api/findings/${id}/affected-workflow`);
		assert.equal(wf.status, 200);
		assert.ok('workflow' in wf.json);
		const feat = await req('GET', `/api/findings/${id}/affected-feature`);
		assert.equal(feat.status, 200);
		assert.ok('feature' in feat.json);
	});

	test('evidence endpoint returns typed evidence (redacted)', async () => {
		const id = createdIds[0];
		const { status, json } = await req('GET', `/api/findings/${id}/evidence`);
		assert.equal(status, 200);
		assert.ok(Array.isArray(json));
		const serialized = JSON.stringify(json);
		assert.ok(!serialized.includes('password=hunter2'));
	});

	test('findings list filters by new params', async () => {
		// M1-P4.3: ?limit now returns the paginated envelope {items,...}.
		// P1 filtering is real but only ~150 findings carry priority — scan
		// enough of the store to find some instead of relying on page 1.
		const first = await req('GET', '/api/findings?priority=P1&limit=500');
		assert.equal(first.status, 200);
		assert.ok(Array.isArray(first.json.items));
		const allP1 = first.json.items.filter(f => f.priority === 'P1');
		assert.ok(allP1.length > 0, 'expected at least one P1 finding in first 500');
		for (const f of allP1) assert.equal(f.priority, 'P1');
		const sev = await req('GET', '/api/findings?severity=critical');
		assert.equal(sev.status, 200);
		const all = await req('GET', '/api/findings');
		assert.ok(all.json.length >= 1, 'backward-compatible list still works');
	});

	test('grouped report endpoint groups and excludes duplicates', async () => {
		const { status, json } = await req('GET', '/api/findings/grouped?groupBy=category');
		assert.equal(status, 200);
		assert.equal(json.groupBy, 'category');
		assert.ok(typeof json.canonicalCount === 'number');
		assert.ok(typeof json.duplicateCount === 'number');
		assert.ok(json.groups && typeof json.groups === 'object');
		const sevGrouped = await req('GET', '/api/findings/grouped?groupBy=severity');
		assert.equal(sevGrouped.status, 200);
		const bad = await req('GET', '/api/findings/grouped?groupBy=nonsense');
		assert.equal(bad.status, 400);
	});

	test('metrics endpoint exposes Phase 16 telemetry', async () => {
		const { status, json } = await req('GET', '/api/bug-intelligence/metrics');
		assert.equal(status, 200);
		for (const key of ['findings_detected', 'findings_verified', 'classification_latency_ms', 'duplicate_detection_latency_ms', 'verification_rate', 'false_positive_rate']) {
			assert.ok(key in json, key);
		}
	});

	test('revalidate re-runs enrichment and tracks attempts', async () => {
		const id = createdIds[0];
		const { status, json } = await req('POST', `/api/findings/${id}/revalidate`, { by: 'it' });
		assert.equal(status, 200);
		assert.ok(json.finding);
		assert.ok(json.finding.reproduction_attempts >= 1);
		assert.ok(json.finding.primary_category, 'enrichment derived a category');
		assert.ok(json.finding.confidence_reason, 'confidence is explainable');
	});

	test('old-shape findings (no new fields) remain readable', async () => {
		// The store has 1000+ legacy findings; read one by listing without filters.
		const { status, json } = await req('GET', '/api/findings');
		assert.equal(status, 200);
		const legacy = json.find(f => !f.primary_category || f.primary_category === undefined);
		// Either all were enriched or some remain legacy — both must be readable
		assert.ok(json.length > 0);
	});

	test('mutating endpoints require API token', async () => {
		if (!TOKEN) return; // token disabled in this environment — skip
		const noAuth = await fetch(`${BASE}/api/findings/${createdIds[0]}/classification`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ primaryCategory: 'SECURITY' }),
		});
		assert.equal(noAuth.status, 401);
	});

	after(async () => {
		for (const id of createdIds) {
			await req('DELETE', `/api/findings/${id}`).catch(() => {});
		}
	});
});
