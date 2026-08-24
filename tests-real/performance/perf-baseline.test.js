/**
 * M1-P2 — PERFORMANCE BASELINE SUITE.
 *
 * Establishes measured baselines for CASE itself (documented in
 * docs/M1-P2-PERFORMANCE-BASELINE.md on first run) and flags regressions
 * beyond tolerance. ADVISORY (non-blocking) per phase rules: no arbitrary
 * enterprise thresholds — tolerances derive from observed behavior.
 */

import { describe, it } from 'node:test';
import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const BASE = process.env.QASE_URL || `http://127.0.0.1:${process.env.PORT || 5173}`;
const TOKEN = process.env.QASE_API_TOKEN || '';
const AUTH = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
const ART = path.join(ROOT, 'artifacts');
fs.mkdirSync(ART, { recursive: true });

// Baselines recorded 2026-08-23 on the dev container (see docs file).
// Tolerance = generous multiples — catches order-of-magnitude rot only.
// (Latency values are worst-observed under concurrent suite load.)
const BASELINES = {
	healthMs: { value: 80, tol: 3 },
	sessionsListMs: { value: 60, tol: 3 },      // 4 sessions (pruned store)
	testCasesListMs: { value: 150, tol: 3 },    // 429 cases / 254 KB
	workflowsListMs: { value: 100, tol: 3 },    // 205 workflows / 50 KB
	schedulesListMs: { value: 60, tol: 3 },     // 12 schedules
	findingsListMs: { value: 250, tol: 4 },     // 2.5k findings, 5.7 MB full array
	findingsPayloadMB: { value: 6.5, tol: 3 },  // full array size
	evidenceGraphParseMs: { value: 400, tol: 3 }, // 28 MB JSON.parse (~255 ms cold)
	uiIndexHtmlMs: { value: 60, tol: 3 }
};

async function timed(p, init) {
	const t0 = performance.now();
	const res = await fetch(`${BASE}${p}`, { ...init, headers: { ...(init?.headers ?? {}), ...AUTH } });
	const buf = await res.arrayBuffer();
	return { ms: performance.now() - t0, status: res.status, bytes: buf.byteLength };
}

function record(name, observed, extra = '') {
	const line = `${name}: ${Math.round(observed.ms ?? observed)}ms ${extra}`;
	fs.appendFileSync(path.join(ART, 'performance-measurements.log'), `${new Date().toISOString()} ${line}\n`);
	return line;
}

describe('PERF — API latency baselines', () => {
	it('health endpoint responds fast', async () => {
		const r = await timed('/api/health');
		assert.equal(r.status, 200);
		assert.ok(r.ms < BASELINES.healthMs.value * BASELINES.healthMs.tol, `health ${r.ms}ms > ${(BASELINES.healthMs.value * BASELINES.healthMs.tol)}ms`);
	});
	it('sessions list (small store) is snappy', async () => {
		const r = await timed('/api/sessions');
		assert.equal(r.status, 200);
		assert.ok(r.ms < BASELINES.sessionsListMs.value * BASELINES.sessionsListMs.tol, `sessions ${r.ms}ms`);
	});
	it('test-cases list (429 rows) within tolerance', async () => {
		const r = await timed('/api/test-cases');
		assert.equal(r.status, 200);
		record('testCasesList', r, `(${Math.round(r.bytes / 1024)}KB)`);
		assert.ok(r.ms < BASELINES.testCasesListMs.value * BASELINES.testCasesListMs.tol, `test-cases ${r.ms}ms`);
	});
	it('workflows list (205) within tolerance', async () => {
		const r = await timed('/api/workflows');
		assert.equal(r.status, 200);
		assert.ok(r.ms < BASELINES.workflowsListMs.value * BASELINES.workflowsListMs.tol, `workflows ${r.ms}ms`);
	});
	it('schedules list (12) within tolerance', async () => {
		const r = await timed('/api/schedules');
		assert.equal(r.status, 200);
		assert.ok(r.ms < BASELINES.schedulesListMs.value * BASELINES.schedulesListMs.tol, `schedules ${r.ms}ms`);
	});
	it('findings list (2.5k rows) — measures the unvirtualized payload cost', async () => {
		const r = await timed('/api/findings');
		assert.equal(r.status, 200);
		const mb = r.bytes / 1024 / 1024;
		record('findingsList', r, `(${mb.toFixed(1)}MB payload)`);
		assert.ok(mb < BASELINES.findingsPayloadMB.value * BASELINES.findingsPayloadMB.tol, `findings payload ${mb.toFixed(1)}MB exploded`);
		assert.ok(r.ms < BASELINES.findingsListMs.value * BASELINES.findingsListMs.tol, `findings ${r.ms}ms`);
	});
	it('index.html served fast (SPA shell)', async () => {
		const r = await timed('/');
		assert.equal(r.status, 200);
		assert.ok(r.ms < BASELINES.uiIndexHtmlMs.value * BASELINES.uiIndexHtmlMs.tol, `index ${r.ms}ms`);
	});
});

describe('PERF — store parse cost (boot-time risk)', () => {
	it('evidence-graph.json parses within tolerance (largest file)', async () => {
		const file = path.join(ROOT, '.qase', 'evidence-graph.json');
		if (!fs.existsSync(file)) return; // advisory skip
		const t0 = performance.now();
		await fs.promises.readFile(file, 'utf8').then(JSON.parse);
		const ms = performance.now() - t0;
		record('evidenceGraphParse', { ms }, `(${(fs.statSync(file).size / 1024 / 1024).toFixed(1)}MB)`);
		assert.ok(ms < BASELINES.evidenceGraphParseMs.value * BASELINES.evidenceGraphParseMs.tol, `graph parse ${ms}ms`);
	});
	it('combined .qase store size flagged when it crosses 100 MB', async () => {
		let total = 0;
		for (const f of await fs.promises.readdir(path.join(ROOT, '.qase'))) {
			const st = await fs.promises.stat(path.join(ROOT, '.qase', f)).catch(() => null);
			if (st?.isFile()) total += st.size;
		}
		record('storeSizeTotal', { ms: 0 }, `(${(total / 1024 / 1024).toFixed(1)}MB)`);
		assert.ok(total < 100 * 1024 * 1024, `.qase stores total ${(total / 1024 / 1024).toFixed(0)}MB — pruning overdue`);
	});
});
