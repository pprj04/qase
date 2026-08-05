/**
 * Phase 9B — Parallel Execution & Retry integration tests.
 *
 * These tests use the server's HTTP API to exercise runTestSuite's parallel
 * worker pool and retry logic end-to-end, without launching a real browser.
 * The replay engine produces 'error' results when Playwright is unavailable
 * (no browser binary), but the summary aggregation, retry non-retry on error,
 * flaky detection, and concurrency plumbing are all verifiable.
 *
 * Run: node --test tests/phase9b-parallel-retry.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const BASE = `http://localhost:${process.env.PORT || 5173}`;
const AUTH = { 'Content-Type': 'application/json', Authorization: 'Bearer qase-5f8a3b2e1d9c4a7f' };

async function post(path, body) {
	const response = await fetch(`${BASE}${path}`, {
		method: 'POST',
		headers: AUTH,
		body: JSON.stringify(body)
	});
	return { status: response.status, data: await response.json() };
}

async function put(path, body) {
	const response = await fetch(`${BASE}${path}`, {
		method: 'PUT',
		headers: AUTH,
		body: JSON.stringify(body)
	});
	return { status: response.status, data: await response.json() };
}

async function get(path) {
	const response = await fetch(`${BASE}${path}`);
	return { status: response.status, data: await response.json() };
}

// -- Helper: create dummy test cases via the API ---------------------------

async function createTestCase(name) {
	const { data } = await post('/api/test-cases', {
		name,
		steps: [{ action: 'navigate', target: 'about:blank' }],
		assertions: [{ type: 'url_is', expected: 'about:blank' }],
		severity: 'low'
	});
	return data.id;
}

describe('Phase 9B — Parallel Execution', () => {

	it('runTestSuite summary includes flaky count field', async () => {
		const id1 = await createTestCase('parallel-1');
		const id2 = await createTestCase('parallel-2');

		const { status, data } = await post('/api/test-cases/run', {
			testCaseIds: [id1, id2],
			concurrency: 2,
			retries: 0
		});

		assert.equal(status, 200);
		assert.equal(data.total, 2);
		assert.equal(typeof data.flaky, 'number');
		assert.equal(Array.isArray(data.results), true);
		assert.equal(data.results.length, 2);
		// Each result should have attempt field
		for (const r of data.results) {
			assert.equal(typeof r.attempt, 'number', 'result should have attempt number');
		}
	});

	it('respects concurrency parameter without error', async () => {
		const ids = [];
		for (let i = 0; i < 4; i++) {
			ids.push(await createTestCase(`conc-test-${i}`));
		}

		const { status, data } = await post('/api/test-cases/run', {
			testCaseIds: ids,
			concurrency: 1,  // sequential
			retries: 0
		});

		assert.equal(status, 200);
		assert.equal(data.total, 4);
		assert.equal(data.results.length, 4);
		// All results present even with concurrency=1
		const allPresent = data.results.every(r => r !== null && r !== undefined);
		assert.ok(allPresent, 'all result slots filled');
	});

	it('falls back to config-based defaults when concurrency/retries omitted', async () => {
		const id1 = await createTestCase('default-conc-1');

		const { status, data } = await post('/api/test-cases/run', {
			testCaseIds: [id1]
			// no concurrency or retries specified
		});

		assert.equal(status, 200);
		assert.equal(data.total, 1);
	});
});

describe('Phase 9B — Retry Logic', () => {

	it('does not retry on error results (infrastructure issue)', async () => {
		const id1 = await createTestCase('retry-error-test');

		const { status, data } = await post('/api/test-cases/run', {
			testCaseIds: [id1],
			concurrency: 1,
			retries: 3  // high retry count
		});

		assert.equal(status, 200);
		// In no-browser environment, result is 'error' which should NOT be retried
		const result = data.results[0];
		assert.ok(result, 'result exists');
		// Error results should have attempt=1 (no retry)
		assert.equal(result.attempt, 1, 'error results are not retried');
		assert.equal(result.flaky, false, 'error results are never flaky');
	});
});

describe('Phase 9B — Config Settings', () => {

	it('GET /api/config returns concurrentRuns and retriesCount', async () => {
		const { status, data } = await get('/api/config');

		assert.equal(status, 200);
		assert.equal(typeof data.concurrentRuns, 'number');
		assert.equal(typeof data.retriesCount, 'number');
		assert.ok(data.concurrentRuns >= 1, 'concurrentRuns >= 1');
		assert.ok(data.retriesCount >= 0, 'retriesCount >= 0');
	});

	it('PUT /api/config persists concurrentRuns and retriesCount', async () => {
		// Save original values first
		const before = await get('/api/config');
		const origConc = before.data.concurrentRuns;
		const origRet = before.data.retriesCount;

		// Update
		const { status, data } = await put('/api/config', {
			// Include required fields from current config
			...before.data,
			concurrentRuns: 5,
			retriesCount: 2
		});
		assert.equal(status, 200);
		assert.equal(data.concurrentRuns, 5);
		assert.equal(data.retriesCount, 2);

		// Verify it persisted
		const after = await get('/api/config');
		assert.equal(after.data.concurrentRuns, 5);
		assert.equal(after.data.retriesCount, 2);

		// Restore original values
		await put('/api/config', {
			...before.data,
			concurrentRuns: origConc,
			retriesCount: origRet
		});
	});

	it('rejects out-of-range concurrentRuns', async () => {
		const before = await get('/api/config');

		const { status, data } = await put('/api/config', {
			...before.data,
			concurrentRuns: 100  // above max of 20
		});

		assert.equal(status, 200);
		// Should be clamped to max
		assert.equal(data.concurrentRuns, 20);
	});

	it('rejects negative retriesCount', async () => {
		const before = await get('/api/config');

		const { status, data } = await put('/api/config', {
			...before.data,
			retriesCount: -1
		});

		assert.equal(status, 200);
		// Should be clamped to 0
		assert.equal(data.retriesCount, 0);
	});
});

describe('Phase 9B — JUnit XML with Flaky', () => {

	it('includes flaky note in system-out when a test is flaky', async () => {
		// Build JUnit XML directly with a mock summary that has a flaky test
		// Since we can't produce a real flaky result without a browser,
		// verify the buildJUnitXml function handles the field correctly
		// by importing it.
		const { buildJUnitXml } = await import('../server/junit.js');

		const summary = {
			total: 2,
			passed: 2,
			failed: 0,
			errored: 0,
			results: [
				{ testCaseId: 'tc-1', name: 'Login flow', result: 'pass', durationMs: 1000, flaky: false },
				{ testCaseId: 'tc-2', name: 'Search test', result: 'pass', durationMs: 2000, flaky: true, attempt: 2 }
			]
		};

		const xml = buildJUnitXml(summary);
		assert.ok(xml.includes('<system-out>'), 'has system-out element');
		assert.ok(xml.includes('Flaky'), 'includes Flaky annotation');
		assert.ok(xml.includes('attempt 2'), 'includes attempt number');
	});

	it('omits flaky note when no tests are flaky', async () => {
		const { buildJUnitXml } = await import('../server/junit.js');

		const summary = {
			total: 1,
			passed: 1,
			failed: 0,
			errored: 0,
			results: [
				{ testCaseId: 'tc-1', name: 'Normal test', result: 'pass', durationMs: 1000, flaky: false }
			]
		};

		const xml = buildJUnitXml(summary);
		assert.ok(!xml.includes('Flaky'), 'no Flaky annotation when none flaky');
	});
});

describe('Phase 9B — Regression Store Flaky', () => {

	it('regression trend data includes flaky field', async () => {
		const { status, data } = await get('/api/regression/trend?limit=5');

		assert.equal(status, 200);
		assert.ok(Array.isArray(data), 'trend is an array');
		// Each point should have flaky field (may be 0 or undefined if no runs)
		for (const point of data) {
			assert.ok('flaky' in point, 'trend point has flaky field');
		}
	});
});
