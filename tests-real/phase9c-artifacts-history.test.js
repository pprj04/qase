/**
 * Phase 9C — Persistent Run Artifacts & Per-Test History integration tests.
 *
 * Tests:
 * 1. Artifact route serves files and blocks path traversal
 * 2. replayStore.addRun() stores screenshot/trace paths
 * 3. GET /api/test-cases/:id/runs returns history with artifact fields
 * 4. Trace path is recorded in results
 *
 * Run: node --test tests/phase9c-artifacts-history.test.js
 */

import { describe, it } from 'node:test';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// M1-P2 fix (docs/M1-P2-TESTING-BASELINE.md §G): artifacts must be created
// in the directory the SERVER serves from. Normally the test suite and the
// server share a checkout (this resolves to the same path); when QASE_ROOT
// is set (e.g. suite run from a separate checkout), we write there so the
// route genuinely serves our dummy file. Assertion strength unchanged.
const ARTIFACTS_DIR = join(process.env.QASE_ROOT ?? join(__dirname, '..'), '.qase', 'artifacts');

const BASE = `http://localhost:${process.env.PORT || 5173}`;
const AUTH = { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.QASE_API_TOKEN}` };

async function post(path, body) {
	const response = await fetch(`${BASE}${path}`, {
		method: 'POST',
		headers: AUTH,
		body: JSON.stringify(body)
	});
	return { status: response.status, data: await response.json() };
}

async function get(path) {
	// B1 W3: anonymous GETs are 401 — read routes (incl. artifacts) require the token.
	const response = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${process.env.QASE_API_TOKEN}` } });
	return { status: response.status, data: await response.json() };
}

// -- Setup: create a dummy test case and dummy artifact files ---------------

const DUMMY_RUN_ID = 'test-run-c9a-0001';
const DUMMY_RUN_ID_2 = 'test-run-c9a-0002';

function setupDummyArtifacts() {
	// Create a dummy screenshot on disk
	const dir1 = join(ARTIFACTS_DIR, DUMMY_RUN_ID);
	mkdirSync(dir1, { recursive: true });
	writeFileSync(join(dir1, 'step-0.jpeg'), Buffer.from('dummy-jpeg-data'));
	writeFileSync(join(dir1, 'trace.zip'), Buffer.from('dummy-trace-zip'));
}

function cleanupDummyArtifacts() {
	for (const id of [DUMMY_RUN_ID, DUMMY_RUN_ID_2]) {
		const dir = join(ARTIFACTS_DIR, id);
		try { rmSync(dir, { recursive: true }); } catch { /* ok */ }
	}
}

describe('Phase 9C — Artifact Route', () => {

	it('GET /api/artifacts/:runId/:filename serves an existing file', async () => {
		setupDummyArtifacts();
		try {
			// B1 W3: artifacts require auth (anonymous screenshots were an open read surface).
			const response = await fetch(`${BASE}/api/artifacts/${DUMMY_RUN_ID}/step-0.jpeg`,
				{ headers: { Authorization: `Bearer ${process.env.QASE_API_TOKEN}` } });
			assert.equal(response.status, 200);
			const body = await response.text();
			assert.ok(body.length > 0, 'file has content');
		} finally {
			cleanupDummyArtifacts();
		}
	});

	it('GET /api/artifacts/:runId/:filename returns 404 for missing file', async () => {
		const response = await fetch(`${BASE}/api/artifacts/nonexistent-run/step-0.jpeg`,
			{ headers: { Authorization: `Bearer ${process.env.QASE_API_TOKEN}` } });
		assert.equal(response.status, 404);
	});

	it('GET /api/artifacts rejects path traversal attempts', async () => {
		// Try directory traversal
		const response1 = await fetch(`${BASE}/api/artifacts/..%2F..%2F/etc/passwd`);
		assert.ok(response1.status >= 400, 'traversal blocked');

		// Try with encoded dots
		const response2 = await fetch(`${BASE}/api/artifacts/../../../etc/passwd`);
		assert.ok(response2.status >= 400 || response2.status === 404, 'traversal blocked');
	});
});

describe('Phase 9C — replayStore persistence', () => {

	it('addRun() stores screenshotPaths and tracePath', async () => {
		// Import replayStore directly
		const { addRun, listRuns } = await import('../server/replayStore.js');

		// Create a mock result with screenshot paths and trace
		const mockResult = {
			id: DUMMY_RUN_ID_2,
			testCaseId: 'test-tc-c9a-persistence',
			testCaseName: 'Persistence Test',
			ts: Date.now(),
			result: 'fail',
			flaky: false,
			attempt: 1,
			durationMs: 5000,
			stepResults: [{ stepIndex: 0, action: 'click', status: 'fail', error: 'element not found', durationMs: 1000 }],
			assertionResults: [],
			screenshots: [{ label: 'Step 1: click failed', artifactPath: `${DUMMY_RUN_ID_2}/step-0.jpeg` }],
			screenshotPaths: [`${DUMMY_RUN_ID_2}/step-0.jpeg`],
			tracePath: `${DUMMY_RUN_ID_2}/trace.zip`,
			error: undefined
		};

		const stored = addRun(mockResult);

		assert.equal(stored.testCaseId, 'test-tc-c9a-persistence');
		assert.ok(Array.isArray(stored.screenshotPaths), 'screenshotPaths is an array');
		assert.equal(stored.screenshotPaths.length, 1);
		assert.equal(stored.screenshotPaths[0], `${DUMMY_RUN_ID_2}/step-0.jpeg`);
		assert.equal(stored.tracePath, `${DUMMY_RUN_ID_2}/trace.zip`);
		assert.equal(stored.flaky, false);
		assert.equal(stored.attempt, 1);

		// Verify it shows up in listRuns
		const runs = listRuns('test-tc-c9a-persistence');
		assert.ok(runs.length > 0, 'run is retrievable');
		const found = runs.find(r => r.id === DUMMY_RUN_ID_2);
		assert.ok(found, 'specific run found');
		assert.ok(found.screenshotPaths.length > 0, 'screenshotPaths present in stored run');
		assert.ok(found.tracePath, 'tracePath present in stored run');
	});

	it('addRun() handles results without screenshot/trace fields', async () => {
		const { addRun, listRuns } = await import('../server/replayStore.js');

		const minimalResult = {
			id: 'test-run-c9a-minimal',
			testCaseId: 'test-tc-c9a-minimal',
			ts: Date.now(),
			result: 'pass',
			durationMs: 1000,
			stepResults: [],
			assertionResults: [],
			screenshots: []
		};

		const stored = addRun(minimalResult);
		assert.ok(Array.isArray(stored.screenshotPaths), 'screenshotPaths defaults to empty array');
		assert.equal(stored.screenshotPaths.length, 0);
		assert.equal(stored.tracePath, undefined);
		assert.equal(stored.flaky, false);
		assert.equal(stored.attempt, 1);
	});
});

describe('Phase 9C — Per-Test-Case History API', () => {

	it('GET /api/test-cases/:id/runs returns array with artifact fields', async () => {
		// First create a test case to ensure the route works
		const { data: tc } = await post('/api/test-cases', {
			name: 'History API Test',
			steps: [{ action: 'navigate', target: 'about:blank' }],
			assertions: [{ type: 'url_is', expected: 'about:blank' }],
			severity: 'low'
		});

		// Get its run history (should be empty or have entries from prior tests)
		const { status, data } = await get(`/api/test-cases/${tc.id}/runs`);
		assert.equal(status, 200);
		assert.ok(Array.isArray(data), 'returns an array');

		// Clean up — use the testCases API
		const delResp = await fetch(`${BASE}/api/test-cases/${tc.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${process.env.QASE_API_TOKEN}` } });
		// Delete may return 200 with JSON or 204, either is fine
		assert.ok(delResp.status < 400, 'delete succeeded');
	});

	it('GET /api/test-cases/:id/runs entries have expected fields when populated', async () => {
		// This test verifies the schema of stored runs.
		// We check via replayStore directly since we can't produce browser results.
		const { addRun, listRuns } = await import('../server/replayStore.js');

		const tcId = 'test-tc-c9a-schema';
		addRun({
			id: 'test-run-c9a-schema-1',
			testCaseId: tcId,
			ts: Date.now(),
			result: 'fail',
			flaky: true,
			attempt: 2,
			durationMs: 3000,
			stepResults: [],
			assertionResults: [],
			screenshots: [{ artifactPath: 'test-run-c9a-schema-1/step-0.jpeg' }],
			tracePath: 'test-run-c9a-schema-1/trace.zip'
		});

		const runs = listRuns(tcId);
		assert.ok(runs.length > 0);
		const run = runs[0];
		assert.equal(typeof run.ts, 'number');
		assert.equal(typeof run.result, 'string');
		assert.equal(typeof run.durationMs, 'number');
		assert.equal(typeof run.flaky, 'boolean');
		assert.equal(typeof run.attempt, 'number');
		assert.ok(Array.isArray(run.screenshotPaths));
		assert.ok('tracePath' in run);
	});
});

describe('Phase 9C — Single Run Detail', () => {

	it('GET /api/test-cases/:id/runs returns most recent first', async () => {
		const { addRun, listRuns } = await import('../server/replayStore.js');

		// Use a unique ID so no interference from other tests
		const tcId = `test-tc-c9a-sort-${Date.now()}`;
		addRun({ id: `${tcId}-r1`, testCaseId: tcId, ts: 1000, result: 'pass', durationMs: 100, stepResults: [], assertionResults: [], screenshots: [] });
		addRun({ id: `${tcId}-r2`, testCaseId: tcId, ts: 3000, result: 'fail', durationMs: 200, stepResults: [], assertionResults: [], screenshots: [] });
		addRun({ id: `${tcId}-r3`, testCaseId: tcId, ts: 2000, result: 'pass', durationMs: 300, stepResults: [], assertionResults: [], screenshots: [] });

		const runs = listRuns(tcId);
		assert.equal(runs.length, 3, 'exactly 3 runs for this test case');
		// Newest first: 3000, 2000, 1000
		assert.equal(runs[0].ts, 3000);
		assert.equal(runs[1].ts, 2000);
		assert.equal(runs[2].ts, 1000);
	});
});
