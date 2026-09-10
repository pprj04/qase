'use strict';

/**
 * Phase 11a findings store — v2 (lean store-level regression suite).
 * Run: node --test tests/phase11a-findings-store-v2.test.js
 *
 * Companion to tests/phase11a-findings-store.test.js: same store, but
 * env-driven BASE (default http://localhost:5173), strict 401 gate check,
 * lifecycle transitions on a fresh record, and metrics parity. Kept lean
 * deliberately — the sibling suite carries the exhaustive CRUD coverage.
 */

import { describe, it, before, after } from 'node:test';
import 'dotenv/config';
import assert from 'node:assert/strict';

const BASE = process.env.QASE_BASE_URL_FIXTURE || 'http://localhost:5173';
const TOKEN = process.env.QASE_API_TOKEN;

async function api(method, path, body, useAuth = true) {
	const headers = { 'Content-Type': 'application/json' };
	if (useAuth) headers.Authorization = `Bearer ${TOKEN}`;
	const res = await fetch(`${BASE}${path}`, {
		method, headers, body: body ? JSON.stringify(body) : undefined,
	});
	let json = null; try { json = await res.json(); } catch { /* no body */ }
	return { status: res.status, json };
}

describe('findings store v2', () => {
	let findingId = null;

	before(async () => {
		if (!TOKEN) throw new Error('QASE_API_TOKEN required');
	});

	it('rejects unauthenticated writes → 401 (board GET is public by design)', async () => {
		const r = await api('POST', '/api/findings', {
			title: 'should never be created', severity: 'low', category: 'functional',
		}, false);
		assert.equal(r.status, 401);
	});

	it('creates a finding and returns store defaults', async () => {
		const r = await api('POST', '/api/findings', {
			title: 'v2 store: transient lifecycle probe',
			severity: 'low', category: 'functional',
			url: 'http://localhost:9901/', steps: ['Go to http://localhost:9901/'],
			expected: 'page loads', actual: 'n/a',
		});
		assert.equal(r.status, 201);
		findingId = r.json.id;
		assert.equal(r.json.status, 'open');
		assert.equal(r.json.finding_status, 'DETECTED');
		assert.ok(Array.isArray(r.json.history) && r.json.history.length >= 1);
	});

	it('walks the status lifecycle open → in_testing → resolved', async () => {
		const r1 = await api('PATCH', `/api/findings/${findingId}/status`, { status: 'in_testing' });
		assert.equal(r1.status, 200);
		assert.equal(r1.json.status, 'in_testing');
		const r2 = await api('PATCH', `/api/findings/${findingId}/status`, { status: 'resolved' });
		assert.equal(r2.status, 200);
		assert.equal(r2.json.status, 'resolved');
	});

	it('rejects invalid status values → 404 (store contract, unchanged since Phase 11)', async () => {
		const r = await api('PATCH', `/api/findings/${findingId}/status`, { status: 'bogus' });
		assert.equal(r.status, 404);
		const verify = await api('GET', `/api/findings/${findingId}`);
		assert.equal(verify.json.status, 'resolved'); // unchanged by the rejected write
	});

	it('metrics endpoint reflects the store consistently', async () => {
		// Dashboard and Bugs list use the same first-class findings store.
		const m = await api('GET', '/api/metrics/dashboard');
		assert.equal(m.status, 200);
		assert.ok(typeof m.json.findings === 'object');
		const listed = await api('GET', '/api/findings');
		assert.equal(listed.status, 200);
		assert.equal(m.json.findings.total, listed.json.length,
			'metrics.findings.total must equal the canonical findings-store API scope');
		assert.equal(m.json.findings.canonical + m.json.findings.duplicates, m.json.findings.total);
		assert.ok(m.json.findings.total >= 0);
	});

	it('deletes the probe finding', async () => {
		const r = await api('DELETE', `/api/findings/${findingId}`);
		assert.equal(r.status, 204);
	});
});
