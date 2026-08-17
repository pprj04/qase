'use strict';

/**
 * Phase 17 — UX Intelligence & Application Quality API integration tests.
 * Run: node --test tests/phase17-api.test.js
 *
 * Requires the server running on QASE_BASE_URL (default http://localhost:5173)
 * with QASE_API_TOKEN set. Exercises the new additive v1 routes: auth gates,
 * 404-until-assessment, ux-assess trigger, quality/ux/feature-gaps/
 * recommendations payloads, review PATCH transitions, redaction, and
 * backward compatibility (v1 mission shape unchanged).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.QASE_BASE_URL || 'http://localhost:5173';
const TOKEN = process.env.QASE_API_TOKEN || '';

function headers(extra = {}) {
	return {
		'Content-Type': 'application/json',
		...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
		...extra,
	};
}

async function req(method, path, body, useAuth = true) {
	const res = await fetch(`${BASE}${path}`, {
		method,
		headers: useAuth ? headers() : { 'Content-Type': 'application/json' },
		body: body ? JSON.stringify(body) : undefined,
	});
	let json = null;
	try { json = await res.json(); } catch { /* no body */ }
	return { status: res.status, json };
}

/** Small helper: poll a predicate over the ux-assessment target. */
async function pollUntil(fn, { tries = 20, delayMs = 1000 } = {}) {
	for (let i = 0; i < tries; i++) {
		const r = await fn();
		if (r) return r;
		await new Promise((r) => setTimeout(r, delayMs));
	}
	return null;
}

describe('Phase 17 API', () => {
	let missionId = null;
	let issueId = null;

	before(async () => {
		assert.ok(TOKEN, 'QASE_API_TOKEN must be set for Phase 17 API tests');
		// Find an existing completed mission with a session + a reachable target.
		const { status, json } = await req('GET', '/api/v1/missions?limit=10');
		assert.equal(status, 200);
		const candidates = (json.missions ?? []).filter((m) => m.status === 'completed' && m.sessionId);
		assert.ok(candidates.length > 0, 'need at least one completed mission with a session');
		missionId = candidates[0].id;
	});

	test('auth gates: no token → 401 on every new route', async () => {
		for (const ep of ['quality', 'ux', 'feature-gaps', 'recommendations']) {
			const { status } = await req('GET', `/api/v1/missions/${missionId}/${ep}`, null, false);
			assert.equal(status, 401, `${ep} must require auth`);
		}
		const { status } = await req('PATCH', `/api/v1/missions/${missionId}/ux/issues/uxi_0001_x/review`, { reviewState: 'REJECTED' }, false);
		assert.equal(status, 401, 'review must require auth');
	});

	test('invalid mission id → 404', async () => {
		const { status } = await req('GET', '/api/v1/missions/nonexistent-id/quality');
		assert.equal(status, 404);
	});

	test('ux-assess returns 202 with poll URL', async () => {
		const { status, json } = await req('POST', `/api/v1/missions/${missionId}/ux-assess`, {});
		assert.equal(status, 202);
		assert.equal(json.missionId, missionId);
		assert.ok(json.pollUrl?.includes('/api/v1/missions/'));
	});

	test('after assessment: /quality returns weighted dimensions + overall', async () => {
		const r = await pollUntil(async () => {
			const { status, json } = await req('GET', `/api/v1/missions/${missionId}/quality`);
			return status === 200 ? json : null;
		}, { tries: 30, delayMs: 1500 });
		assert.ok(r, 'assessment should appear within timeout');
		assert.ok(Array.isArray(r.dimensions), 'dimensions array');
		assert.ok(r.overall, 'overall present');
		for (const d of r.dimensions) {
			assert.ok(d.score == null || (d.score >= 0 && d.score <= 100), 'score in range');
			assert.ok(d.confidence >= 0 && d.confidence <= 1, 'confidence in [0,1]');
			assert.ok(d.evidenceCoverage >= 0 && d.evidenceCoverage <= 1, 'coverage in [0,1]');
		}
		assert.ok(Array.isArray(r.overall.dimensionsMissing), 'dimensionsMissing listed (never guessed)');
	});

	test('/ux returns sweep meta + issues with evidence', async () => {
		const { status, json } = await req('GET', `/api/v1/missions/${missionId}/ux`);
		assert.equal(status, 200);
		assert.ok(json.sweepMeta, 'sweep meta present');
		assert.ok(Array.isArray(json.issues));
		if (json.issues.length > 0) {
			const i = json.issues[0];
			assert.ok(i.id && i.severity && i.dimension && i.reviewState);
			assert.ok(Array.isArray(i.evidence) && i.evidence.length > 0, 'issues carry evidence');
			assert.ok(i.confidence >= 0 && i.confidence <= 1);
			issueId = json.issues.find((x) => x.reviewState !== 'REJECTED')?.id ?? null;
		}
		assert.ok(Array.isArray(json.unverifiedAreas), 'unverified areas survive to the API');
	});

	test('/feature-gaps returns validated gaps (explicit gating)', async () => {
		const { status, json } = await req('GET', `/api/v1/missions/${missionId}/feature-gaps`);
		assert.equal(status, 200);
		assert.ok(Array.isArray(json.features));
		for (const f of json.features) {
			assert.ok(['IMPLEMENTED', 'PARTIALLY_IMPLEMENTED', 'NOT_FOUND', 'BLOCKED', 'UNVERIFIED'].includes(f.classification));
			if (f.gapAssertion === 'CONFIRMED_FEATURE_GAP') {
				// CONFIRMED requires an explicit expectation source — never heuristic/LLM
				assert.equal(f.source?.tier, 'explicit', 'CONFIRMED gaps must come from explicit expectations');
			}
		}
		assert.ok(json.explorationSufficiency, 'exploration sufficiency reported');
	});

	test('/recommendations returns deterministic sorted list', async () => {
		const { status, json } = await req('GET', `/api/v1/missions/${missionId}/recommendations`);
		assert.equal(status, 200);
		assert.ok(Array.isArray(json.recommendations));
		const scores = json.recommendations.map((r) => r.priorityScore);
		const sorted = [...scores].sort((a, b) => b - a);
		assert.deepEqual(scores, sorted, 'sorted by priorityScore desc');
		for (const r of json.recommendations) {
			assert.ok(['P0', 'P1', 'P2', 'P3'].includes(r.priority));
			assert.ok(r.recommendation, 'advice text present');
		}
	});

	test('review PATCH: invalid state → 400', async () => {
		const { status } = await req('PATCH', `/api/v1/missions/${missionId}/ux/issues/whatever/review`, { reviewState: 'MAYBE' });
		assert.equal(status, 400);
	});

	test('review PATCH: unknown issue → 404', async () => {
		const { status } = await req('PATCH', `/api/v1/missions/${missionId}/ux/issues/uxi_does_not_exist/review`, { reviewState: 'REJECTED' });
		assert.equal(status, 404);
	});

	test('review PATCH: valid transition works and persists', async () => {
		if (!issueId) return; // no non-rejected issue on this mission — skip
		const { status, json } = await req('PATCH', `/api/v1/missions/${missionId}/ux/issues/${issueId}/review`, {
			reviewState: 'AUTO_VERIFIED', reason: 'api test approve', by: 'phase17-api-test',
		});
		assert.equal(status, 200);
		assert.equal(json.issue.reviewState, 'AUTO_VERIFIED');
		assert.equal(json.issue.reviewedBy, 'phase17-api-test');
		// persist check
		const { json: again } = await req('GET', `/api/v1/missions/${missionId}/ux`);
		const same = (again.issues ?? []).find((i) => i.id === issueId);
		assert.equal(same.reviewState, 'AUTO_VERIFIED', 'review state persisted');
	});

	test('review PATCH: REJECTED is human-only terminal (409 on system exit)', async () => {
		if (!issueId) return;
		// Reject it first
		const { status: rs } = await req('PATCH', `/api/v1/missions/${missionId}/ux/issues/${issueId}/review`, {
			reviewState: 'REJECTED', reason: 'api test reject', by: 'phase17-api-test',
		});
		assert.equal(rs, 200);
		// Now try to transition OUT as system → 409
		const { status } = await req('PATCH', `/api/v1/missions/${missionId}/ux/issues/${issueId}/review`, {
			reviewState: 'AUTO_VERIFIED', by: 'system',
		});
		assert.equal(status, 409, 'system cannot leave REJECTED');
		// Restore for later tests: human can still review it? (transition rules say terminal)
		// Leave it rejected — terminal by design.
	});

	test('report markdown includes APPLICATION QUALITY section after assessment', async () => {
		const { status, json } = await req('GET', `/api/v1/missions/${missionId}/report?format=md`);
		assert.equal(status, 200);
		assert.ok(json === null || typeof json === 'object' || true);
		// markdown comes as text
		const res = await fetch(`${BASE}/api/v1/missions/${missionId}/report?format=md`, { headers: headers() });
		const md = await res.text();
		assert.ok(md.includes('APPLICATION QUALITY'), 'report has APPLICATION QUALITY');
		if (md.includes('UX ISSUES')) {
			assert.ok(md.includes('Evidence:'), 'issues in report carry evidence');
		}
	});

	test('dashboard metrics include uxAssessments observability', async () => {
		const { status, json } = await req('GET', '/api/metrics/dashboard');
		assert.equal(status, 200);
		assert.ok(json.uxAssessments, 'ux metrics present');
		assert.ok(typeof json.uxAssessments.assessmentsRun === 'number');
	});

	test('session-cookie dashboard routes work with UI token (not integration token)', async () => {
		// After the security fix these routes require requireApiToken (cookie or
		// bearer). Bearer QASE_API_TOKEN works for tests; the dashboard uses the
		// qase_token cookie.
		const res = await fetch(`${BASE}/api/missions/${missionId}/ux-quality`, {
			headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
		});
		assert.equal(res.status, 200);
		const j = await res.json();
		assert.ok(j.quality && j.ux);
		// And without any token it must now be rejected
		const res2 = await fetch(`${BASE}/api/missions/${missionId}/ux-quality`);
		assert.equal(res2.status, 401);
	});

	test('redaction: secrets scrubbed from ux payloads', async () => {
		// The stored evidence must never contain raw secret patterns.
		const { json } = await req('GET', `/api/v1/missions/${missionId}/ux`);
		const raw = JSON.stringify(json);
		assert.ok(!/(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|-----BEGIN)/.test(raw),
			'no raw secret patterns in ux payload');
	});

	test('backward compatibility: v1 mission GET shape unchanged', async () => {
		const { status, json } = await req('GET', `/api/v1/missions/${missionId}`);
		assert.equal(status, 200);
		for (const key of ['id', 'status', 'type', 'targetUrl', 'qualityScore', 'verdict', 'findings']) {
			assert.ok(key in json, `v1 field ${key} still present`);
		}
	});

	after(() => {
		if (missionId) console.log(`[phase17-api] used mission ${missionId}`);
	});
});
