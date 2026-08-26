/**
 * C1 — Dev Team usage/traffic API integration tests.
 *
 * Covers:
 *   - G1: /api/v2/health anonymous (real probe, no header)
 *   - G2: /api/v2/usage/summary correctness vs persisted stores, windows,
 *     bucket shapes, malformed input → 400
 *   - G3: /api/v2/metrics/api-usage counting + envelope + since marker
 *   - Security negatives across the v2 surface (anonymous → 401, bad token →
 *     401, malformed dates → 400)
 *   - Pagination clamp (page_size=99999 → 500)
 *   - Performance smoke: large page + big window under generous latency bound
 *
 * Requires a running server (QASE_BASE_URL, default localhost:5173) and
 * QASE_API_TOKEN in the environment. Skips otherwise.
 */

import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = process.env.QASE_BASE_URL || 'http://localhost:5173';
const TOKEN = process.env.QASE_API_TOKEN || '';
const HAS = Boolean(TOKEN);
const SKIP = { skip: !HAS && 'QASE_API_TOKEN required' };

function headers() {
	return TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
}

async function get(path, extraHeaders = {}) {
	const res = await fetch(`${BASE}${path}`, { headers: { ...headers(), ...extraHeaders } });
	let json = null;
	try { json = await res.json(); } catch { /* no body */ }
	return { status: res.status, json };
}

function storeCount(file) {
	const raw = JSON.parse(readFileSync(`/workspace/.qase/${file}`, 'utf8'));
	return Array.isArray(raw) ? raw.length : (raw.data ?? raw.items ?? []).length;
}

describe('C1 — G1 public health', () => {
	test('anonymous GET /api/v2/health → 200 (no auth header at all)', async () => {
		const res = await fetch(`${BASE}/api/v2/health`);
		assert.equal(res.status, 200);
		const json = await res.json();
		assert.equal(json.status, 'ok');
	});

	test('anonymous GET /api/v2/openapi-sibling route still 401 (only health is public)', async () => {
		const res = await fetch(`${BASE}/api/v2/projects`);
		assert.equal(res.status, 401);
	});
});

describe('C1 — G2 usage/summary', SKIP, () => {
	test('returns window/totals/mixes/buckets with zero-axis for empty days', async () => {
		const { status, json } = await get('/api/v2/usage/summary?from=2026-01-01&to=2026-01-08');
		assert.equal(status, 200);
		assert.equal(json.window.from, '2026-01-01T00:00:00.000Z');
		assert.equal(json.window.bucket, 'day');
		// Jan 2026 has no data — every bucket must exist and be zero, not absent.
		assert.equal(json.buckets.length, 7);
		for (const b of json.buckets) {
			assert.equal(b.missions_created, 0);
			assert.equal(b.findings_reported, 0);
		}
		assert.equal(json.totals.missions_created, 0);
	});

	test('from-only window: buckets extend to now, totals == bucket sums (Finding B regression)', async () => {
		const { status, json } = await get('/api/v2/usage/summary?from=2026-08-24');
		assert.equal(status, 200);
		assert.ok(json.buckets.length >= 1, `expected ≥1 bucket, got ${json.buckets.length}`);
		// The effective `to` is now-ish, not null.
		assert.ok(json.window.to, 'window.to must echo the effective upper bound');
		const sum = json.buckets.reduce((a, b) => a + b.missions_created, 0);
		assert.equal(sum, json.totals.missions_created);
	});

	test('to-only window: buckets from the oldest record, no TDZ crash (Finding B regression)', async () => {
		const { status, json } = await get('/api/v2/usage/summary?to=2026-08-26');
		assert.equal(status, 200, 'to-only must not 500 (declaration-order TDZ bug)');
		assert.ok(json.buckets.length >= 1, `expected ≥1 bucket, got ${json.buckets.length}`);
		assert.ok(json.window.from, 'window.from must echo the effective lower bound');
		const sum = json.buckets.reduce((a, b) => a + b.missions_created, 0);
		assert.equal(sum, json.totals.missions_created);
	});

	test('bucket sums equal totals for a real window', async () => {
		const { status, json } = await get('/api/v2/usage/summary');
		assert.equal(status, 200);
		const sum = (key) => json.buckets.reduce((a, b) => a + b[key], 0);
		assert.equal(sum('missions_created'), json.totals.missions_created);
		assert.equal(sum('findings_reported'), json.totals.findings_reported);
		assert.equal(sum('fix_validations'), json.totals.fix_validations);
		assert.equal(sum('regression_runs'), json.totals.regression_runs);
	});

	test('all-time totals match persisted store counts (missions at least)', async () => {
		// Earliest mission date → today, verified against missions.json.
		const missions = JSON.parse(readFileSync('/workspace/.qase/missions.json', 'utf8'));
		const list = Array.isArray(missions) ? missions : missions.data;
		const minTs = Math.min(...list.map(m => m.createdAt).filter(Number.isFinite));
		const from = new Date(Math.floor(minTs / 86400000) * 86400000).toISOString().slice(0, 10);
		const { status, json } = await get(`/api/v2/usage/summary?from=${from}&to=2100-01-01`);
		assert.equal(status, 200);
		assert.equal(json.totals.missions_created, list.length,
			`expected ${list.length} missions (store), got ${json.totals.missions_created}`);
	});

	test('hour buckets have the hour shape', async () => {
		const { status, json } = await get('/api/v2/usage/summary?bucket=hour&from=2026-08-26&to=2026-08-27');
		assert.equal(status, 200);
		assert.equal(json.buckets.length, 24);
		assert.match(json.buckets[0].bucket, /T00:00:00Z$/);
	});

	test('malformed from → 400; unknown bucket → 400', async () => {
		let r = await get('/api/v2/usage/summary?from=notadate&to=2026-08-26');
		assert.equal(r.status, 400);
		r = await get('/api/v2/usage/summary?bucket=week');
		assert.equal(r.status, 400);
	});

	test('source/status mixes sum to missions_created', async () => {
		const { json } = await get('/api/v2/usage/summary');
		const srcSum = Object.values(json.mission_source_mix).reduce((a, b) => a + b, 0);
		const stSum = Object.values(json.mission_status_mix).reduce((a, b) => a + b, 0);
		assert.equal(srcSum, json.totals.missions_created);
		assert.equal(stSum, json.totals.missions_created);
	});
});

describe('C1 — G3 metrics/api-usage', SKIP, () => {
	test('returns envelope + since marker; counting is live', async () => {
		const before = await get('/api/v2/metrics/api-usage');
		assert.equal(before.status, 200);
		assert.ok(Array.isArray(before.json.data));
		assert.ok(Number.isInteger(before.json.total));
		assert.ok(typeof before.json.since === 'string');

		// Make 2 authenticated calls, then the total must not decrease.
		await get('/api/v2/bug-taxonomy');
		await get('/api/v2/bug-taxonomy');
		const after = await get('/api/v2/metrics/api-usage');
		const today = after.json.data.find(r => r.day === new Date().toISOString().slice(0, 10));
		assert.ok(today, 'today row exists');
		assert.ok(today.endpoints['/bug-taxonomy'] >= 2, 'counted the two calls');
	});

	test('authenticated-only: anonymous calls are not usage', async () => {
		const before = await get('/api/v2/metrics/api-usage');
		// Fire an anonymous request that 401s.
		await fetch(`${BASE}/api/v2/missions`);
		const after = await get('/api/v2/metrics/api-usage');
		const sum = (d) => d.json.data.reduce((a, r) => a + r.total, 0);
		assert.ok(sum(after) >= sum(before), 'totals never decrease');
		// The anonymous 401 must not have counted as an authenticated call —
		// strictly: at most the /metrics/api-usage call itself was added.
		assert.ok(sum(after) - sum(before) <= 1);
	});
});

describe('C1 — security negatives on the v2 surface', SKIP, () => {
	test('anonymous → 401 on every sampled collection', async () => {
		const paths = [
			'/api/v2/projects', '/api/v2/missions', '/api/v2/sessions', '/api/v2/findings',
			'/api/v2/test-cases', '/api/v2/workflows', '/api/v2/suites', '/api/v2/schedules',
			'/api/v2/regression/runs', '/api/v2/fix-validations', '/api/v2/knowledge',
			'/api/v2/usage/summary', '/api/v2/metrics/dashboard', '/api/v2/metrics/api-usage',
		];
		for (const p of paths) {
			const res = await fetch(`${BASE}${p}`);
			assert.equal(res.status, 401, `${p} must 401 anonymously`);
		}
	});

	test('invalid token → 401', async () => {
		const res = await fetch(`${BASE}/api/v2/missions`, { headers: { Authorization: 'Bearer wrong-token' } });
		assert.equal(res.status, 401);
	});

	test('no secrets in v2 responses', SKIP, async () => {
		const { json } = await get('/api/v2/usage/summary');
		const blob = JSON.stringify(json);
		assert.ok(!/sk-[A-Za-z0-9]{10,}/.test(blob), 'no API key patterns');
		assert.ok(!/Bearer /.test(blob), 'no bearer literals');
		assert.ok(!blob.includes('/workspace/'), 'no filesystem paths');
		assert.ok(!blob.includes('.qase/'), 'no store paths');
	});
});

describe('C1 — pagination clamp + perf smoke', SKIP, () => {
	test('page_size=99999 clamps to 500', async () => {
		const { status, json } = await get('/api/v2/missions?page_size=99999');
		assert.equal(status, 200);
		assert.equal(json.page_size, 500);
		assert.ok(json.data.length <= 500);
	});

	test('usage/summary over a 30-day window answers fast', async () => {
		const t0 = Date.now();
		const { status } = await get('/api/v2/usage/summary?from=2026-07-27&to=2026-08-26');
		const ms = Date.now() - t0;
		assert.equal(status, 200);
		assert.ok(ms < 5000, `summary took ${ms}ms — must stay well under Pulse's 30s`);
	});

	test('500-row missions page answers fast', async () => {
		const t0 = Date.now();
		const { status, json } = await get('/api/v2/missions?page_size=500');
		const ms = Date.now() - t0;
		assert.equal(status, 200);
		assert.ok(ms < 3000, `500-row page took ${ms}ms`);
		assert.ok(json.data.length > 0);
	});

	test('concurrent requests all succeed', async () => {
		const calls = Array.from({ length: 10 }, () => get('/api/v2/findings?page_size=100'));
		const results = await Promise.all(calls);
		for (const r of results) assert.equal(r.status, 200);
	});
});

describe('C1 — G3 telemetry store bounds (regression: reviewer FAIL fix)', SKIP, () => {
	test('pattern cap: 250 distinct unmatched paths collapse to ≤200 keys + __other__', async () => {
		// Hitting 250 distinct non-existent paths must NOT create 250 store keys
		// for the day — the prune() cap folds overflow into __other__.
		const reqs = [];
		for (let i = 0; i < 250; i++) {
			reqs.push(get(`/api/v2/zzz-bound-probe-${i}`));
		}
		await Promise.all(reqs);
		const { status, json } = await get('/api/v2/metrics/api-usage?page_size=1');
		assert.equal(status, 200);
		// The endpoint response itself only carries per-day rows; inspect the
		// persisted store for the actual key count (that is what grows on disk).
		const store = JSON.parse(readFileSync('/workspace/.qase/api-usage.json', 'utf8'));
		const today = new Date().toISOString().slice(0, 10);
		const todayKeys = Object.keys(store.days?.[today] ?? {});
		assert.ok(
			todayKeys.length <= 200,
			`expected ≤200 endpoint patterns for ${today}, got ${todayKeys.length}`,
		);
		assert.ok(todayKeys.includes('__other__'), 'overflow must roll into __other__');
		// Probe requests must not have inflated the *today* total beyond bound
		const total = todayKeys.reduce((a, k) => a + store.days[today][k], 0);
		assert.ok(Number.isFinite(total) && total >= 250, 'probes were counted');
	});
});
