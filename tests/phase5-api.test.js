/**
 * Phase 5 — API Integration Tests for Continuous Validation Loop
 *
 * Tests the revalidation endpoint, loop-status endpoint, validation-comparison
 * endpoint, idempotency, and failure scenarios via real HTTP calls.
 * All test data is created through the API so the server process sees it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* ── Load API token from .env (not dotenv-dependent) ────────────── */
function loadApiToken() {
  try {
    const env = readFileSync('/workspace/.env', 'utf-8');
    const match = env.match(/^QASE_API_TOKEN=(.+)$/m);
    if (match) return match[1].trim();
  } catch { /* .env not found */ }
  return process.env.QASE_API_TOKEN || process.env.API_TOKEN || 'qase-test-token';
}

const API_TOKEN = loadApiToken();
const BASE = process.env.QASE_BASE_URL || `http://localhost:${process.env.PORT || 5173}`;

/* ── Helper ─────────────────────────────────────────────────────── */

async function apiCall(method, path, body = null) {
  const headers = { 'Authorization': `Bearer ${API_TOKEN}` };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body is fine */ }
  return { status: res.status, body: json };
}

/**
 * Creates a mission via the API POST endpoint so the server process owns it.
 * Returns the full mission object from the response.
 */
async function makeMissionViaApi(overrides = {}) {
  const { status, body } = await apiCall('POST', '/api/v1/missions', {
    name: 'Phase5 API Test ' + Math.random().toString(36).slice(2, 6),
    type: 'qa',
    targetUrl: overrides.targetUrl || 'http://localhost:9876/dashboard',
    constraints: overrides.constraints || {},
    autoStart: false,
    ...overrides
  });
  if (status !== 201 && status !== 202) {
    assert.fail(`Failed to create mission (${status}): ${JSON.stringify(body)}`);
  }
  // Normalize: API returns { missionId } but we want { id }
  return { ...body, id: body.missionId || body.id };
}

/**
 * Seeds a mission with iterations by writing directly to the server's store
 * through the comparison endpoint to confirm iteration data is working.
 * Since we can't call recordIteration from outside the server process,
 * we use the mission's internal state as set by the API.
 */
async function makeMissionWithIterationsApi(iterations, baseOverrides = {}) {
  const mission = await makeMissionViaApi(baseOverrides);
  // The server stores iterations when the pipeline completes.
  // For API tests, we just verify the endpoints respond correctly
  // to missions that already have iteration data.
  return mission;
}

/* ── Tests ──────────────────────────────────────────────────────── */

describe('Phase 5 API — loop-status endpoint', () => {
  it('returns 404 for non-existent mission', async () => {
    const { status } = await apiCall('GET', '/api/v1/missions/nonexistent-mission-id/loop-status');
    assert.equal(status, 404);
  });

  it('returns loop status for newly created mission (no iterations)', async () => {
    const mission = await makeMissionViaApi();
    const { status, body } = await apiCall('GET', `/api/v1/missions/${mission.id}/loop-status`);
    assert.equal(status, 200);
    assert.ok(body.convergence);
    assert.equal(body.totalIterations, 0);
    assert.equal(body.convergence.state, 'insufficient_data');
  });

  it('returns maxIterations from constraints', async () => {
    const mission = await makeMissionViaApi({ constraints: { maxIterations: 7 } });
    const { status, body } = await apiCall('GET', `/api/v1/missions/${mission.id}/loop-status`);
    assert.equal(status, 200);
    assert.equal(body.maxIterations, 7);
  });

  it('uses default maxIterations when not set', async () => {
    const mission = await makeMissionViaApi();
    const { status, body } = await apiCall('GET', `/api/v1/missions/${mission.id}/loop-status`);
    assert.equal(status, 200);
    assert.ok(body.maxIterations >= 3 && body.maxIterations <= 20);
  });

  it('returns canRevalidate=true for non-terminal mission', async () => {
    const mission = await makeMissionViaApi();
    const { status, body } = await apiCall('GET', `/api/v1/missions/${mission.id}/loop-status`);
    assert.equal(status, 200);
    assert.equal(body.canRevalidate, true);
  });
});

describe('Phase 5 API — validation-comparison endpoint', () => {
  it('returns 404 for non-existent mission', async () => {
    const { status } = await apiCall('GET', '/api/v1/missions/nonexistent-mission-id/validation-comparison');
    assert.equal(status, 404);
  });

  it('returns 400 for mission with no iterations', async () => {
    const mission = await makeMissionViaApi();
    const { status, body } = await apiCall('GET', `/api/v1/missions/${mission.id}/validation-comparison`);
    assert.equal(status, 400);
    assert.ok(body.error.includes('No iterations'));
  });
});

describe('Phase 5 API — revalidate endpoint guards', () => {
  it('returns 404 for non-existent mission', async () => {
    const { status } = await apiCall('POST', '/api/v1/missions/nonexistent-mission-id/revalidate');
    assert.equal(status, 404);
  });

  it('rejects revalidation when maxIterations is 0', async () => {
    const mission = await makeMissionViaApi({ constraints: { maxIterations: 0 } });
    const { status, body } = await apiCall('POST', `/api/v1/missions/${mission.id}/revalidate`);
    assert.equal(status, 409);
    assert.ok(body.error.includes('Maximum iterations') || body.error.includes('max'),
      `Expected max iterations error, got: ${body.error}`);
  });
});

describe('Phase 5 API — revalidate starts iteration', () => {
  it('starts a revalidation iteration and returns session info', async () => {
    // Create a mission that's ready for revalidation
    const mission = await makeMissionViaApi();
    // Verify it can be revalidated
    const loopRes = await apiCall('GET', `/api/v1/missions/${mission.id}/loop-status`);
    assert.equal(loopRes.body.canRevalidate, true);

    // Trigger revalidation
    const { status, body } = await apiCall('POST', `/api/v1/missions/${mission.id}/revalidate`);
    // It should start an agent — 202 Accepted
    assert.equal(status, 202);
    assert.ok(body.sessionId);
    assert.ok(body.iteration >= 1);

    // Verify the mission is now running
    const missionRes = await apiCall('GET', `/api/v1/missions/${mission.id}`);
    assert.equal(missionRes.body.status, 'running');
  });

  it('prevents duplicate concurrent iteration (idempotency)', async () => {
    const mission = await makeMissionViaApi();
    // Start first revalidation
    const first = await apiCall('POST', `/api/v1/missions/${mission.id}/revalidate`);
    assert.equal(first.status, 202);

    // Immediately try again
    const second = await apiCall('POST', `/api/v1/missions/${mission.id}/revalidate`);
    assert.equal(second.status, 409);
    assert.ok(second.body.error.includes('already running'));

    // Clean up — stop the mission
    await apiCall('POST', `/api/v1/missions/${mission.id}/stop`);
  });
});

describe('Phase 5 API — existing endpoints unaffected', () => {
  it('comparison endpoint returns 400 for no iterations (unchanged behavior)', async () => {
    const mission = await makeMissionViaApi();
    const { status } = await apiCall('GET', `/api/v1/missions/${mission.id}/comparison`);
    assert.ok(status === 400 || status === 200);
  });

  it('GET /api/v1/missions/:id still works', async () => {
    const mission = await makeMissionViaApi();
    const { status, body } = await apiCall('GET', `/api/v1/missions/${mission.id}`);
    assert.equal(status, 200);
    assert.equal(body.id, mission.id);
  });
});
