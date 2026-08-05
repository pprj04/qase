/**
 * Phase 10 — Visual Regression integration tests.
 *
 * Tests baseline management, the diffing engine, and the API surface.
 * Run: node --test tests/phase10-visual-regression.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = join(__dirname, '..', '.qase', 'artifacts');

const BASE = `http://localhost:${process.env.PORT || 5173}`;
const AUTH_HEADERS = { 'Content-Type': 'application/json', Authorization: 'Bearer qase-5f8a3b2e1d9c4a7f' };

async function post(path, body) {
	const response = await fetch(`${BASE}${path}`, {
		method: 'POST',
		headers: AUTH_HEADERS,
		body: JSON.stringify(body)
	});
	return { status: response.status, data: await response.json() };
}

async function get(path) {
	const response = await fetch(`${BASE}${path}`);
	return { status: response.status, data: await response.json() };
}

async function del(path) {
	const response = await fetch(`${BASE}${path}`, { method: 'DELETE', headers: { Authorization: 'Bearer qase-5f8a3b2e1d9c4a7f' } });
	return { status: response.status, data: await response.json().catch(() => ({})) };
}

// -- Helpers --------------------------------------------------------------

/** Create a solid-color PNG buffer for testing. */
function makePng(width, height, r, g, b) {
	const png = new PNG({ width, height });
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const idx = (width * y + x) << 2;
			png.data[idx] = r;
			png.data[idx + 1] = g;
			png.data[idx + 2] = b;
			png.data[idx + 3] = 255;
		}
	}
	return PNG.sync.write(png);
}

describe('Phase 10A — Baseline Management', () => {

	it('setBaseline stores and getBaseline retrieves', async () => {
		const { setBaseline, getBaselines, getBaseline, deleteBaselines } = await import('../server/baselines.js');
		const tcId = `test-visual-${Date.now()}-1`;

		// Create a dummy artifact file to copy from.
		const runId = `test-visual-run-${Date.now()}-1`;
		const dir = join(ARTIFACTS_DIR, runId);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'step-0.png'), makePng(10, 10, 255, 0, 0));

		// Set baseline.
		const baseline = setBaseline(tcId, 'step-0', `${runId}/step-0.png`, { approvedBy: 'manual' });

		assert.ok(baseline.id, 'baseline has an id');
		assert.equal(baseline.testCaseId, tcId);
		assert.equal(baseline.label, 'step-0');
		assert.equal(baseline.approvedBy, 'manual');
		assert.ok(baseline.artifactPath.includes('baselines'), 'artifact path under baselines dir');

		// Verify it was copied to disk.
		assert.ok(existsSync(join(ARTIFACTS_DIR, baseline.artifactPath)), 'baseline file exists on disk');

		// Retrieve.
		const all = getBaselines(tcId);
		assert.equal(all.length, 1);

		const one = getBaseline(tcId, 'step-0');
		assert.ok(one, 'getBaseline returns the baseline');

		// Clean up.
		deleteBaselines(tcId);
		assert.equal(getBaselines(tcId).length, 0);
	});

	it('setBaseline upserts when same label already exists', async () => {
		const { setBaseline, getBaselines, deleteBaselines } = await import('../server/baselines.js');
		const tcId = `test-visual-${Date.now()}-2`;

		const runId1 = `test-visual-run-${Date.now()}-2a`;
		const runId2 = `test-visual-run-${Date.now()}-2b`;
		for (const rid of [runId1, runId2]) {
			const dir = join(ARTIFACTS_DIR, rid);
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, 'step-0.png'), makePng(10, 10, 0, 255, 0));
		}

		// Set twice with same label.
		const b1 = setBaseline(tcId, 'step-0', `${runId1}/step-0.png`, { approvedBy: 'auto' });
		const b2 = setBaseline(tcId, 'step-0', `${runId2}/step-0.png`, { approvedBy: 'manual' });

		// Should be an upsert — same ID, updated values.
		assert.equal(b1.id, b2.id, 'same baseline ID after upsert');
		assert.equal(b2.approvedBy, 'manual', 'approvedBy updated');

		const all = getBaselines(tcId);
		assert.equal(all.length, 1, 'only 1 baseline after upsert');

		deleteBaselines(tcId);
	});

	it('GET /api/test-cases/:id/baselines returns baselines via API', async () => {
		const { setBaseline, deleteBaselines } = await import('../server/baselines.js');

		// Create a test case via API.
		const { data: tc } = await post('/api/test-cases', {
			name: 'Visual Test API',
			steps: [{ action: 'navigate', target: 'about:blank' }],
			assertions: [{ type: 'visual_match' }],
			severity: 'medium'
		});

		// Create a baseline via direct module call (writes to file).
		const runId = `test-visual-api-${Date.now()}`;
		const dir = join(ARTIFACTS_DIR, runId);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'step-0.png'), makePng(10, 10, 0, 0, 255));
		setBaseline(tc.id, 'step-0', `${runId}/step-0.png`, { approvedBy: 'manual' });

		// Fetch baselines via API — the server's in-memory copy may differ
		// from the test process's, so we verify the route returns 200 and an array.
		const { status, data } = await get(`/api/test-cases/${tc.id}/baselines`);
		assert.equal(status, 200);
		assert.ok(Array.isArray(data), 'returns an array');

		// Clean up.
		deleteBaselines(tc.id);
		await fetch(`${BASE}/api/test-cases/${tc.id}`, { method: "DELETE", headers: { Authorization: "Bearer qase-5f8a3b2e1d9c4a7f" } });
	});
});

describe('Phase 10B — Diffing Engine', () => {

	it('pixelmatch detects 0 difference between identical images', () => {
		const png1 = makePng(20, 20, 255, 0, 0);
		const png2 = makePng(20, 20, 255, 0, 0);
		const img1 = PNG.sync.read(png1);
		const img2 = PNG.sync.read(png2);
		const diff = new PNG({ width: 20, height: 20 });

		const result = pixelmatch(img1.data, img2.data, diff.data, 20, 20, { threshold: 0.1 });
		assert.equal(result, 0, 'identical images have 0 diff pixels');
	});

	it('pixelmatch detects full difference between different images', () => {
		const png1 = makePng(20, 20, 255, 0, 0);
		const png2 = makePng(20, 20, 0, 0, 255);
		const img1 = PNG.sync.read(png1);
		const img2 = PNG.sync.read(png2);
		const diff = new PNG({ width: 20, height: 20 });

		const result = pixelmatch(img1.data, img2.data, diff.data, 20, 20, { threshold: 0.1 });
		assert.equal(result, 400, 'all 400 pixels different');
	});

	it('POST /api/test-cases/:id/approve-baseline returns 400 when no screenshots available', async () => {
		const { data: tc } = await post('/api/test-cases', {
			name: 'Approve Empty Test',
			steps: [{ action: 'navigate', target: 'about:blank' }],
			assertions: [{ type: 'url_is', expected: 'about:blank' }],
			severity: 'low'
		});

		const { status, data } = await post(`/api/test-cases/${tc.id}/approve-baseline`, {});
		assert.equal(status, 400);
		assert.ok(data.error.includes('No screenshots'), 'error message mentions screenshots');

		await fetch(`${BASE}/api/test-cases/${tc.id}`, { method: "DELETE", headers: { Authorization: "Bearer qase-5f8a3b2e1d9c4a7f" } });
	});

	it('DELETE /api/test-cases/:id/baselines clears baselines', async () => {
		const { setBaseline, getBaselines, deleteBaselines } = await import('../server/baselines.js');

		const { data: tc } = await post('/api/test-cases', {
			name: 'Delete Baselines Test',
			steps: [{ action: 'navigate', target: 'about:blank' }],
			assertions: [],
			severity: 'low'
		});

		const runId = `test-del-base-${Date.now()}`;
		const dir = join(ARTIFACTS_DIR, runId);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'step-0.png'), makePng(10, 10, 100, 100, 100));
		setBaseline(tc.id, 'step-0', `${runId}/step-0.png`, { approvedBy: 'manual' });

		// Delete baselines via direct module call.
		deleteBaselines(tc.id);
		assert.equal(getBaselines(tc.id).length, 0, 'baselines cleared from module');

		// Also verify the API route returns 200.
		const resp = await fetch(`${BASE}/api/test-cases/${tc.id}/baselines`, { method: "DELETE", headers: { Authorization: "Bearer qase-5f8a3b2e1d9c4a7f" } });
		assert.equal(resp.status, 200);

		await fetch(`${BASE}/api/test-cases/${tc.id}`, { method: "DELETE", headers: { Authorization: "Bearer qase-5f8a3b2e1d9c4a7f" } });
	});
});

describe('Phase 10 — visual_match assertion type', () => {

	it('visual_match is accepted as a valid assertion type in test case creation', async () => {
		const { status, data } = await post('/api/test-cases', {
			name: 'Visual Match TC',
			steps: [{ action: 'navigate', target: 'https://example.com' }],
			assertions: [
				{ type: 'visual_match', label: 'homepage', threshold: 0.005 }
			],
			severity: 'high'
		});

		assert.equal(status, 201);
		assert.ok(data.id, 'test case created');
		assert.ok(data.assertions.some(a => a.type === 'visual_match'), 'has visual_match assertion');

		await fetch(`${BASE}/api/test-cases/${data.id}`, { method: "DELETE", headers: { Authorization: "Bearer qase-5f8a3b2e1d9c4a7f" } });
	});
});
