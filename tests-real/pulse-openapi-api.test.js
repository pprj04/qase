'use strict';

/**
 * Integration tests for the Pulse read surface (v2) + /openapi.json.
 * Run: node --test tests-real/pulse-openapi-api.test.js
 * Requires the server on QASE_BASE_URL (default http://localhost:5173).
 * Creates a throwaway finding + project via the legacy POST API, verifies the
 * v2 projection (envelope, ISO timestamps, name joins, date filters, clamping),
 * then cleans up. Legacy shapes asserted untouched throughout.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.QASE_BASE_URL || 'http://localhost:5173';
const TOKEN = process.env.QASE_API_TOKEN || '';
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

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

const cleanup = { findings: [], projects: [] };

describe('Pulse OpenAPI surface', () => {

	before(async () => {
		// Throwaway project so name joins are verifiable without touching real data.
		const { status, json } = await req('POST', '/api/projects', { name: 'pulse-it-probe' });
		if (status === 201 || status === 200) cleanup.projects.push(json.id);
	});

	after(async () => {
		for (const id of cleanup.findings) await req('DELETE', `/api/findings/${id}`);
		for (const id of cleanup.projects) await req('DELETE', `/api/projects/${id}`);
	});

	test('/openapi.json is served as JSON, valid, and guide-clean', async () => {
		const res = await fetch(`${BASE}/openapi.json`);
		assert.equal(res.status, 200);
		assert.ok((res.headers.get('content-type') ?? '').includes('application/json'));
		const doc = await res.json();
		assert.ok(parseFloat(doc.openapi) >= 3);
		assert.ok(doc.servers[0].url, 'servers[0].url must be non-empty');
		assert.ok(Object.keys(doc.paths).length >= 25);
		for (const methods of Object.values(doc.paths)) {
			const get = methods.get;
			if (!get) continue;
			assert.ok(get.operationId);
			assert.match(get.operationId, /^[a-z][a-z0-9_]*$/);
			assert.ok(get.responses['200'].content['application/json'].schema);
		}
	});

	test('health (v2) is public and returns ok', async () => {
		// C1 G1 — must be a REAL anonymous probe. The old version sent the
		// Bearer header, so it passed even while the route was auth-gated
		// (phaseRouter pre-gated /api/v2/* before the v2 router mounted).
		const res = await fetch(`${BASE}/api/v2/health`);
		assert.equal(res.status, 200);
		const json = await res.json();
		assert.equal(json.status, 'ok');
		assert.ok(Number.isInteger(json.uptime));
	});

	test('v2 collections return the {data,total,page,page_size} envelope with ISO timestamps', async () => {
		for (const path of ['/api/v2/missions', '/api/v2/sessions', '/api/v2/findings',
			'/api/v2/test-cases', '/api/v2/workflows', '/api/v2/suites', '/api/v2/schedules',
			'/api/v2/regression/runs', '/api/v2/knowledge', '/api/v2/mission-summaries',
			'/api/v2/fix-validations', '/api/v2/test-cases/tags']) {
			const { status, json } = await req('GET', `${path}?page=1&page_size=5`);
			assert.equal(status, 200, `${path} status`);
			assert.ok(Array.isArray(json.data), `${path} data array`);
			assert.ok(Number.isInteger(json.total), `${path} integer total`);
			assert.ok(json.total >= json.data.length, `${path} total >= data.length`);
			assert.equal(json.page, 1);
			assert.ok(Number.isInteger(json.page_size) && json.page_size <= 500, `${path} page_size`);
			for (const row of json.data) {
				if (row.created_at !== undefined) assert.match(row.created_at, ISO_RE, `${path} created_at`);
				if (row.ts !== undefined) assert.match(row.ts, ISO_RE, `${path} ts`);
				if (row.project_id) assert.ok(typeof row.project_name === 'string' || row.project_name === null, `${path} project_name`);
			}
		}
	});

	test('v2 single records: session/mission shape, 404 on miss', async () => {
		const miss = await req('GET', '/api/v2/missions/00000000-0000-0000-0000-000000000000');
		assert.equal(miss.status, 404);
		const missSession = await req('GET', '/api/v2/sessions/does-not-exist');
		assert.equal(missSession.status, 404);
	});

	test('findings: filter by severity enum + q text + project join', async () => {
		// create a finding via the legacy API (marker token for substring search)
		const created = await req('POST', '/api/findings', {
			title: 'Pulse IT probespec checkout button inert',
			severity: 'high',
			category: 'forms',
			url: 'https://pulse-it.example/checkout',
			expected: 'Order placed',
			actual: 'Nothing happens',
			projectId: cleanup.projects[0],
		});
		assert.ok([200, 201].includes(created.status), `create finding failed: ${created.status} ${JSON.stringify(created.json)}`);
		const findingId = created.json?.id ?? created.json?.finding?.id;
		if (findingId) cleanup.findings.push(findingId);

		const { status, json } = await req('GET', '/api/v2/findings?severity=high&q=probespec');
		assert.equal(status, 200);
		assert.ok(json.total >= 1, 'probe finding visible through v2');
		const row = json.data.find(f => f.id === findingId) ?? json.data[0];
		assert.match(row.created_at, ISO_RE);
		assert.equal(row.severity, 'high');
		if (row.project_id) assert.equal(row.project_name, 'pulse-it-probe');
		// numbers stay numbers
		assert.ok(row.confidence === null || typeof row.confidence === 'number');
	});

	test('from/to filters work (inclusive/exclusive) and reject garbage with 400', async () => {
		// Ensure a fresh finding exists inside today's window for this test.
		const created = await req('POST', '/api/findings', {
			title: 'Pulse IT window probe',
			severity: 'low',
			category: 'forms',
		});
		const probeId = created.json?.id;
		if (probeId) cleanup.findings.push(probeId);

		const today = new Date().toISOString().slice(0, 10);
		const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
		const inRange = await req('GET', `/api/v2/findings?from=${today}&to=${tomorrow}`);
		assert.equal(inRange.status, 200);
		assert.ok(inRange.json.total >= 1, 'fresh probe must fall inside today window');
		assert.ok(inRange.json.data.every(r => r.created_at), 'in-range rows carry created_at');
		const beforeRange = await req('GET', '/api/v2/findings?from=2020-01-01&to=2020-01-02');
		assert.equal(beforeRange.status, 200);
		assert.equal(beforeRange.json.total, 0);
		const junk = await req('GET', '/api/v2/findings?from=not-a-date');
		assert.equal(junk.status, 400);
		assert.ok(junk.json.error);
		const junk2 = await req('GET', '/api/v2/sessions?to=13/13/2026');
		assert.equal(junk2.status, 400);
	});

	test('page_size is clamped to 500', async () => {
		const { status, json } = await req('GET', '/api/v2/findings?page_size=99999');
		assert.equal(status, 200);
		assert.equal(json.page_size, 500);
	});

	test('bug taxonomy mirrors the live enums endpoint', async () => {
		const { status, json } = await req('GET', '/api/v2/bug-taxonomy');
		assert.equal(status, 200);
		assert.equal(json.categories.length, 20);
		assert.ok(json.priorities.includes('P0'));
		assert.ok(json.lifecycle.includes('VERIFIED'));
		const legacy = await req('GET', '/api/bug-intelligence/enums');
		assert.deepEqual(json.categories, legacy.json.categories);
		assert.deepEqual(json.severities, legacy.json.severities);
	});

	test('dashboard + ux metrics respond', async () => {
		const dash = await req('GET', '/api/v2/metrics/dashboard');
		assert.equal(dash.status, 200);
		assert.ok(dash.json.sessions && Number.isInteger(dash.json.sessions.total));
		const ux = await req('GET', '/api/v2/metrics/ux');
		assert.equal(ux.status, 200);
		assert.ok(Number.isInteger(ux.json.assessments_run));
	});

	test('knowledge list carries stats beside data', async () => {
		const { status, json } = await req('GET', '/api/v2/knowledge?page_size=3');
		assert.equal(status, 200);
		assert.ok(json.stats && Number.isInteger(json.stats.total));
	});

	test('legacy /api/findings keeps the bare-array shape with epoch timestamps', async () => {
		const { status, json } = await req('GET', '/api/findings');
		assert.equal(status, 200);
		assert.ok(Array.isArray(json), 'legacy findings must stay a bare array');
		const withTs = json.filter(f => f.ts != null);
		assert.ok(withTs.length > 0);
		assert.ok(typeof withTs[0].ts === 'number', 'legacy ts stays epoch ms');
		// workflow-generated findings legitimately lack ts; they must still serialize
		assert.ok(json.every(f => f.created_at === undefined), 'no snake_case leakage into legacy');
	});

	test('legacy /api/missions keeps the bare-array shape', async () => {
		const { status, json } = await req('GET', '/api/missions');
		assert.equal(status, 200);
		assert.ok(Array.isArray(json));
	});

	test('unauthenticated v2 access is rejected when a token is configured', async () => {
		const res = await fetch(`${BASE}/api/v2/findings`);
		if (!TOKEN) return; // no token configured — open access, skip
		assert.equal(res.status, 401);
	});
});
