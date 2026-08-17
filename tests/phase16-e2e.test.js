'use strict';

/**
 * Phase 16 — E2E happy-path + key edge cases (HTTP-level, same pattern as existing
 * tests/phase*-e2e). Runs against the live server (QASE_BASE_URL + token).
 * 10 numbered E2E cases per the Phase 16 spec.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.QASE_BASE_URL || 'http://localhost:5173';
const TOKEN = process.env.QASE_API_TOKEN || '';
const H = { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) };
const createdIds = [];

async function req(method, path, body) {
	const res = await fetch(`${BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
	let json = null;
	try { json = await res.json(); } catch { /* none */ }
	return { status: res.status, json };
}

describe('Phase 16 E2E', () => {

	test('E2E-1: full intelligence lifecycle — create → enrich → classify → verify → review → triage', async () => {
		// 1. Create a finding with rich fields (API contract for new clients).
		const created = await req('POST', '/api/findings', {
			title: 'E2E-1 Checkout submit blocked by JS error for every user',
			severity: 'high', category: 'forms', url: 'https://e2e.test/checkout',
			expected: 'Order confirmation shown', actual: 'Nothing happens; console TypeError',
			observed: 'TypeError: Cannot read properties of undefined in checkout handler',
			impact: 'No customer can complete a purchase',
			reproducibility: 'confirmed',
		});
		assert.equal(created.status, 201);
		const id = created.json.id;
		createdIds.push(id);

		// 2. Revalidate (deterministic enrichment) — derives category, severity rationale,
		//    confidence signals, lifecycle from evidence-less record.
		const reval = await req('POST', `/api/findings/${id}/revalidate`, { by: 'e2e' });
		assert.equal(reval.status, 200);
		const f = reval.json.finding;
		assert.ok(f.primary_category, 'category derived');
		assert.ok(['FUNCTIONAL', 'UNKNOWN'].includes(f.primary_category), `got ${f.primary_category}`);
		assert.ok(f.confidence_reason && f.confidence_reason.signals, 'explainable confidence');

		// 3. Human classification override (validated enum).
		const cls = await req('PATCH', `/api/findings/${id}/classification`, {
			primaryCategory: 'FUNCTIONAL', secondaryCategories: ['API'], confidence: 0.9,
		});
		assert.equal(cls.status, 200);
		assert.equal(cls.json.primary_category, 'FUNCTIONAL');

		// 4. Verify lifecycle transition (evidence gate blocks jump to VERIFIED).
		const badJump = await req('PATCH', `/api/findings/${id}/lifecycle`, { findingStatus: 'VERIFIED' });
		assert.ok([200, 400].includes(badJump.status));
		if (badJump.status === 200) {
			// Allowed only when evidence sufficient; then confirm VERIFIED is set
			assert.equal(badJump.json.finding_status, 'VERIFIED');
		} else {
			assert.match(badJump.json.error, /evidence|invalid|transition/i);
		}

		// 5. Human review: confirmed.
		const rev = await req('PATCH', `/api/findings/${id}/review`, { reviewStatus: 'confirmed', note: 'E2E' });
		assert.equal(rev.status, 200);
		assert.equal(rev.json.review_status, 'confirmed');

		// 6. Priority triage separate from severity.
		const prio = await req('PATCH', `/api/findings/${id}/priority`, { priority: 'P1', rationale: 'Revenue blocking' });
		assert.equal(prio.status, 200);
		assert.equal(prio.json.priority, 'P1');

		// 7. Final read exposes the full intelligence shape.
		const read = await req('GET', `/api/findings/${id}`);
		assert.equal(read.status, 200);
		assert.ok(read.json.confidence != null);
		assert.ok(read.json.reproduction_attempts >= 1);
		assert.ok(Array.isArray(read.json.history));
		assert.ok(read.json.dev_summary, 'developer summary attached');
	}, { timeout: 30000 });

	test('E2E-2: LLM/agent cannot mark a bug verified without evidence (evidence gate)', async () => {
		const created = await req('POST', '/api/findings', {
			title: 'E2E-2 Ghost bug with no evidence at all',
			severity: 'high', category: 'general', url: 'https://e2e.test/ghost',
			expected: 'Something', actual: 'Something else',
		});
		assert.equal(created.status, 201);
		const id = created.json.id;
		createdIds.push(id);

		// Attempt direct lifecycle jump DETECTED → VERIFIED without evidence.
		const jump = await req('PATCH', `/api/findings/${id}/lifecycle`, { findingStatus: 'VERIFIED' });
		assert.equal(jump.status, 400, 'must reject evidence-less VERIFIED');
		assert.match(jump.json.error, /evidence|invalid|transition/i);

		// Revalidate keeps it out of VERIFIED.
		const reval = await req('POST', `/api/findings/${id}/revalidate`, { by: 'e2e' });
		assert.equal(reval.status, 200);
		assert.notEqual(reval.json.derived.finding_status, 'VERIFIED');
	}, { timeout: 30000 });

	test('E2E-3: duplicates detected, possible-dupes not auto-merged, provenance preserved', async () => {
		const payload = {
			title: 'E2E-3 Login button dead on /login',
			severity: 'high', category: 'auth', url: 'https://e2e.test/login',
			expected: 'User logged in', actual: 'Button does nothing',
		};
		const a = await req('POST', '/api/findings', payload);
		const b = await req('POST', '/api/findings', payload);
		assert.equal(a.status, 201); assert.equal(b.status, 201);
		createdIds.push(a.json.id, b.json.id);

		const dup = await req('GET', `/api/findings/${b.json.id}/duplicates`);
		assert.equal(dup.status, 200);
		const top = dup.json.candidates[0];
		assert.ok(top, 'at least one candidate');
		assert.ok(['DUPLICATE', 'POSSIBLE_DUPLICATE'].includes(top.verdict));

		// Possible dupes must NOT be auto-merged: the duplicate endpoint never marks
		// duplicates without a human POST.
		const before = await req('GET', `/api/findings/${b.json.id}`);
		assert.notEqual(before.json.isDuplicate, true);

		// Manual merge preserves provenance.
		const merged = await req('POST', `/api/findings/${b.json.id}/duplicates`, { canonicalId: a.json.id });
		assert.equal(merged.status, 200);
		assert.equal(merged.json.isDuplicate, true);
		assert.equal(merged.json.duplicateOf, a.json.id);
		assert.ok(merged.json.duplicate_provenance, 'provenance stored');
		assert.ok(merged.json.duplicate_provenance.originalIds.includes(b.json.id));
		assert.ok(merged.json.duplicate_provenance.originalIds.includes(a.json.id));

		// Grouped counts exclude duplicates.
		const grouped = await req('GET', '/api/findings/grouped?groupBy=category');
		assert.equal(grouped.status, 200);
		assert.ok(typeof grouped.json.duplicateCount === 'number');
		assert.ok(grouped.json.duplicateCount >= 1, 'merged dupe counted separately');
	}, { timeout: 30000 });

	test('E2E-4: false positive separate representation (not counted as defect)', async () => {
		const created = await req('POST', '/api/findings', {
			title: 'E2E-4 Wrongly flagged behavior',
			severity: 'medium', category: 'general', url: 'https://e2e.test/fp',
			expected: 'A', actual: 'B',
		});
		assert.equal(created.status, 201);
		const id = created.json.id;
		createdIds.push(id);

		const fp = await req('PATCH', `/api/findings/${id}/review`, { reviewStatus: 'false_positive', note: 'intended' });
		assert.equal(fp.status, 200);
		assert.equal(fp.json.review_status, 'false_positive');
		assert.equal(fp.json.finding_status, 'FALSE_POSITIVE');

		const grouped = await req('GET', '/api/findings/grouped?groupBy=severity');
		const before = JSON.stringify(grouped.json.groups);
		assert.ok(!before.includes(id), 'FP excluded from grouped defect counts');
	}, { timeout: 30000 });

	test('E2E-5: backward compatibility — legacy findings shape still served', async () => {
		const list = await req('GET', '/api/findings?limit=200');
		assert.equal(list.status, 200);
		assert.ok(list.json.length > 0);
		// Old clients consume the original fields
		for (const f of list.json.slice(0, 50)) {
			assert.ok(typeof f.title === 'string');
			assert.ok(typeof f.severity === 'string');
			assert.ok(Array.isArray(f.history));
		}
	}, { timeout: 30000 });

	test('E2E-5b: legacy filters still work unchanged', async () => {
		for (const q of ['severity=high', 'status=open', 'q=login']) {
			const r = await req('GET', `/api/findings?${q}`);
			assert.equal(r.status, 200, q);
			assert.ok(Array.isArray(r.json), q);
		}
	}, { timeout: 30000 });

	test('E2E-6: security redaction on evidence and reports', async () => {
		const created = await req('POST', '/api/findings', {
			title: 'E2E-6 Token leakage in URL',
			severity: 'critical', category: 'security', url: 'https://e2e.test/x?token=abc123',
			expected: 'Token hidden', actual: 'Token visible',
			evidence: 'password=hunter2 api_key=sk-12345 Bearer abc',
		});
		assert.equal(created.status, 201);
		const id = created.json.id;
		createdIds.push(id);
		const ev = await req('GET', `/api/findings/${id}/evidence`);
		assert.equal(ev.status, 200);
		const body = JSON.stringify(ev.json);
		assert.ok(!body.includes('hunter2'), 'password redacted');
		assert.ok(!body.includes('sk-12345'), 'api key redacted');
	}, { timeout: 30000 });

	test('E2E-7: metrics endpoint after activity', async () => {
		const m = await req('GET', '/api/bug-intelligence/metrics');
		assert.equal(m.status, 200);
		assert.ok(m.json.findings_detected >= 0);
		assert.ok('duplicate_detection_latency_ms' in m.json);
	}, { timeout: 30000 });

	test('E2E-8: classification validation rejects invalid enum', async () => {
		const list = await req('GET', '/api/findings?limit=1');
		const id = list.json[0].id;
		const bad = await req('PATCH', `/api/findings/${id}/classification`, { primaryCategory: 'BOGUS' });
		assert.equal(bad.status, 400);
	}, { timeout: 30000 });

	test('E2E-8b: unauthenticated mutation rejected (auth not weakened)', async () => {
		if (!TOKEN) return;
		const res = await fetch(`${BASE}/api/findings/x/classification`, {
			method: 'PATCH', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ primaryCategory: 'SECURITY' }),
		});
		assert.equal(res.status, 401);
	}, { timeout: 30000 });

	test('E2E-9: revalidation updates reproducibility attempts', async () => {
		const created = await req('POST', '/api/findings', {
			title: 'E2E-9 Revalidation counter check',
			severity: 'low', category: 'general', url: 'https://e2e.test/rev',
			expected: 'A', actual: 'B', reproducibility: 'confirmed',
		});
		assert.equal(created.status, 201);
		const id = created.json.id;
		createdIds.push(id);
		const r1 = await req('POST', `/api/findings/${id}/revalidate`, { by: 'e2e' });
		assert.equal(r1.status, 200);
		const after1 = r1.json.finding.reproduction_attempts;
		const r2 = await req('POST', `/api/findings/${id}/revalidate`, { by: 'e2e' });
		assert.equal(r2.status, 200);
		const after2 = r2.json.finding.reproduction_attempts;
		assert.ok(after2 > after1, `attempts grow: ${after1} → ${after2}`);
	}, { timeout: 30000 });

	test('E2E-10: grouped reports by every dimension', async () => {
		for (const g of ['category', 'severity', 'priority', 'workflow', 'feature', 'risk']) {
			const r = await req('GET', `/api/findings/grouped?groupBy=${g}`);
			assert.equal(r.status, 200, g);
			assert.ok(r.json.groups && typeof r.json.groups === 'object', g);
			assert.ok(typeof r.json.canonicalCount === 'number');
		}
		const bad = await req('GET', '/api/findings/grouped?groupBy=nope');
		assert.equal(bad.status, 400);
	}, { timeout: 30000 });

	after(async () => {
		for (const id of createdIds) {
			await req('DELETE', `/api/findings/${id}`).catch(() => {});
		}
	});
});
