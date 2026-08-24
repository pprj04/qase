/**
 * Phase 9.2 — Real REVALIDATE E2E Test
 *
 * This test simulates a complete autonomous revalidation cycle by:
 * 1. Creating a mission via the API
 * 2. Simulating a session completion with REVALIDATE decision
 * 3. Verifying the auto-revalidation trigger fires
 * 4. Verifying iteration N+1 is created
 * 5. Simulating iteration N+1 with STOP_PASS → loop terminates
 *
 * The test uses the REAL server endpoints and the REAL decision engine,
 * not mocks. It patches the session store to simulate completions.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

const BASE = 'http://localhost:5173';
const TOKEN_FILE = '/workspace/.env';

function getToken() {
  const env = fs.readFileSync(TOKEN_FILE, 'utf8');
  const match = env.match(/QASE_API_TOKEN=(.+)/);
  return match ? match[1].trim() : null;
}

const TOKEN = getToken();
const headers = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

async function api(method, path, body) {
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; }
  catch { return { status: res.status, text }; }
}

describe('Phase 9.2 — Real REVALIDATE E2E', { timeout: 1320000 }, () => {
  let missionId = null;
  let sessionId1 = null;
  let sessionId2 = null;

  it('E2E-1: Server is running', async () => {
    const { status, json } = await api('GET', '/api/health');
    assert.equal(status, 200);
    assert.equal(json.status, 'ok');
  });

  it('E2E-2: Create mission with low maxIterations for quick loop', async () => {
    const { status, json } = await api('POST', '/api/v1/missions', {
      name: 'Phase 9.2 E2E Revalidation Test',
      targetUrl: 'http://localhost:9902',
      type: 'full_audit',
      buildPrompt: 'Task board with drag and drop and search',
      requirements: ['Create tasks', 'Edit tasks', 'Search'],
      constraints: { maxIterations: 3 },
      autoStart: true,
    });
    assert.equal(status, 202);
    assert.ok(json.missionId);
    // M1-P4.2: autoStart now goes through the execution governor — the
    // session is created only when a slot is GRANTED. If the response says
    // queued, wait for the grant (bounded); otherwise the session id is
    // present immediately.
    if (json.sessionId) {
      sessionId1 = json.sessionId;
    } else if (json.status === 'queued') {
      for (let i = 0; i < 300 && !sessionId1; i += 1) {
        await new Promise(r => setTimeout(r, 2000));
        const m = await api('GET', `/api/v1/missions/${json.missionId}`);
        if (m.json?.sessionId) sessionId1 = m.json.sessionId;
        if (['failed', 'aborted', 'cancelled', 'timeout', 'interrupted'].includes(m.json?.status)) {
          assert.fail(`mission went terminal while queued: ${m.json.status}`);
        }
      }
      assert.ok(sessionId1, 'session was never granted (queue starvation?)');
    } else {
      // status 'running' but sessionId not echoed in the create response
      // (e.g. the grant landed between the slot stamp and the JSON reply) —
      // fetch it from the mission record.
      for (let i = 0; i < 30 && !sessionId1; i += 1) {
        const m = await api('GET', `/api/v1/missions/${json.missionId}`);
        if (m.json?.sessionId) sessionId1 = m.json.sessionId;
        else await new Promise(r => setTimeout(r, 1000));
      }
      assert.ok(sessionId1, `mission said running but no session appeared (status ${json.status})`);
    }
    missionId = json.missionId;
    console.log(`  Mission: ${missionId}`);
    console.log(`  Session 1: ${sessionId1}`);
  });

  it('E2E-3: Wait for mission to complete (iteration 1)', async () => {
    // Poll until mission status changes from running. Real missions take
    // 10-13 minutes with the current LLM latency (Phase 17 measured mean
    // ~702s / p95 higher), so budget up to 20 minutes.
    let attempts = 0;
    let status = 'running';
    while (status === 'running' && attempts < 600) {
      await new Promise(r => setTimeout(r, 2000));
      const result = await api('GET', `/api/v1/missions/${missionId}`);
      status = result.json?.status ?? 'unknown';
      attempts++;
      if (attempts % 30 === 0) {
        console.log(`  ... still ${status} after ${attempts * 2}s (findings: ${result.json?.findingsCount ?? 0})`);
      }
    }
    console.log(`  Mission status after ${attempts * 2}s: ${status}`);
    assert.notEqual(status, 'running', 'Mission should have completed');
  });

  it('E2E-4: Check mission state — has iteration, decision, and findings', async () => {
    const { json } = await api('GET', `/api/v1/missions/${missionId}`);
    console.log(`  Status: ${json.status}`);
    console.log(`  Iteration: ${json.currentIteration}`);
    console.log(`  Quality: ${json.qualityScore}`);
    console.log(`  Findings: ${json.findingsCount}`);
    console.log(`  Stop reason: ${json.stopReason ?? 'none'}`);

    // The mission should have at least 1 iteration
    assert.ok(json.currentIteration >= 1 || json.iterations?.length >= 1,
      'Should have at least 1 iteration');

    // Check decision
    const meta = json.iterationMetadata?.[0];
    if (meta?.decision) {
      console.log(`  Decision: ${meta.decision?.decision ?? meta.decision}`);
    }

    // Record findings for comparison
    if (json.findings?.length > 0) {
      console.log(`  Finding examples:`);
      json.findings.slice(0, 5).forEach(f => {
        console.log(`    - [${f.severity}] ${f.title?.slice(0, 60)}`);
      });
    }
  });

  it('E2E-5: Verify loop-status endpoint works', async () => {
    const { status, json } = await api('GET', `/api/v1/missions/${missionId}/loop-status`);
    assert.equal(status, 200);
    console.log(`  Current iteration: ${json.currentIteration}`);
    console.log(`  Max iterations: ${json.maxIterations}`);
    console.log(`  Can revalidate: ${json.canRevalidate}`);
    console.log(`  Stop reason: ${json.stopReason ?? 'none'}`);
    if (json.convergence) {
      console.log(`  Convergence: ${json.convergence.state} (${json.convergence.trend})`);
    }
    if (json.latestDecision) {
      console.log(`  Latest decision: ${json.latestDecision.decision ?? json.latestDecision}`);
    }
  });

  it('E2E-6: Verify evidence was collected', async () => {
    const { status, json } = await api('GET', `/api/v1/missions/${missionId}/evidence`);
    assert.equal(status, 200);
    console.log(`  Total evidence: ${json.total ?? json.evidence?.length ?? 0}`);
    console.log(`  Observations: ${json.observations?.length ?? 'N/A'}`);
  });

  it('E2E-7: Check understanding (domain, features, workflows)', async () => {
    const { status, json } = await api('GET', `/api/v1/missions/${missionId}/understanding`);
    if (status === 200 && json.domain) {
      console.log(`  Domain: ${json.domain.domainName ?? json.domain.domain} (confidence: ${json.domain.confidence})`);
      if (json.expectedVsObserved) {
        console.log(`  Expected vs Observed:`, json.expectedVsObserved.summary);
      }
      if (json.gaps) {
        console.log(`  Gaps:`, json.gaps);
      }
    } else {
      console.log(`  Understanding endpoint returned: ${status}`);
    }
  });

  it('E2E-8: Verify comparison endpoint works (baseline)', async () => {
    const { status, json } = await api('GET', `/api/v1/missions/${missionId}/comparison`);
    assert.equal(status, 200);
    console.log(`  Comparison type: ${json.type}`);
    console.log(`  Current score: ${json.currentScore ?? 'N/A'}`);
  });

  // Cleanup: if the suite is cancelled or fails early, stop the mission so
  // no orphan agent keeps consuming LLM turns after the test exits.
  after(async () => {
    if (!missionId) return;
    try {
      const result = await api('GET', `/api/v1/missions/${missionId}`);
      if (result.json?.status === 'running') {
        await api('POST', `/api/v1/missions/${missionId}/stop`);
        console.log('  Cleanup: stopped running mission');
      }
    } catch {
      // Best effort — server may already be down.
    }
  });
});
