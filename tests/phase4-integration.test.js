/**
 * Phase 4 — Decision Engine Integration Tests
 *
 * Tests the mission → assessment → decision flow end to end,
 * including capability registration, pipeline execution, and API contracts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DECISION_TYPES,
  TERMINAL_DECISIONS,
  createDecision,
  makeDecision
} from '../server/decisionEngine.js';

/* ── Helper ─────────────────────────────────────────────────────── */

function mockSession(overrides = {}) {
  return {
    id: 'int-session-' + Math.random().toString(36).slice(2, 8),
    findings: [],
    activities: [],
    capturedSteps: [],
    status: 'running',
    startedAt: Date.now() - 60000,
    decisionHistory: [],
    ...overrides
  };
}

function mockMission(overrides = {}) {
  return {
    id: 'int-mission-' + Math.random().toString(36).slice(2, 8),
    type: 'qa',
    constraints: {},
    ...overrides
  };
}

/* ── 1. Capability Integration ──────────────────────────────────── */

describe('Capability Integration', () => {
  it('decision_engine is registered in the capability pipeline', async () => {
    const mod = await import('../server/capabilities.js');
    const registry = mod.createDefaultRegistry();
    const caps = registry.list();
    const decisionCap = caps.find(c => c.id === 'decision_engine');

    assert.ok(decisionCap, 'decision_engine capability must exist');
    assert.equal(decisionCap.dependsOn[0], 'mission_finalize');
    assert.ok(decisionCap.producesEvidence.includes('decision'));
  });

  it('knowledge_write depends on decision_engine (not mission_finalize directly)', async () => {
    const mod = await import('../server/capabilities.js');
    const registry = mod.createDefaultRegistry();
    const caps = registry.list();
    const knowledgeCap = caps.find(c => c.id === 'knowledge_write');

    assert.ok(knowledgeCap.dependsOn.includes('decision_engine'));
  });

  it('pipeline topological sort places decision_engine after mission_finalize and before knowledge_write', async () => {
    const mod = await import('../server/capabilities.js');
    const registry = mod.createDefaultRegistry();
    const orchestrator = new mod.Orchestrator(registry);
    const allIds = registry.list().map(c => c.id);
    const plan = orchestrator.plan(allIds).map(c => c.id);

    const missionFinalizeIdx = plan.indexOf('mission_finalize');
    const decisionEngineIdx = plan.indexOf('decision_engine');
    const knowledgeWriteIdx = plan.indexOf('knowledge_write');

    assert.ok(missionFinalizeIdx >= 0);
    assert.ok(decisionEngineIdx > missionFinalizeIdx, 'decision_engine must come after mission_finalize');
    assert.ok(knowledgeWriteIdx > decisionEngineIdx, 'knowledge_write must come after decision_engine');
  });

  it('decision_engine execute() produces a valid decision', async () => {
    const mod = await import('../server/capabilities.js');
    const registry = mod.createDefaultRegistry();
    const decisionCap = registry.get('decision_engine');

    const session = mockSession({
      status: 'done',
      findings: [],
      capturedSteps: Array.from({ length: 35 }, (_, i) => ({ url: `/page${i}` })),
      activities: Array.from({ length: 35 }, (_, i) => ({ id: `a${i}` }))
    });
    const evidence = {
      missionResult: {
        quality: {
          score: 95,
          verdict: 'pass',
          releaseReady: true,
          confidence: 0.9,
          risk: 'low',
          criticalIssues: [],
          recommendations: [],
          breakdown: {}
        }
      }
    };

    // Execute the capability
    const result = await decisionCap.execute(session, evidence, {});
    assert.ok(result.decision);
    assert.ok(DECISION_TYPES && result.decision.decision in DECISION_TYPES || Object.values(DECISION_TYPES).includes(result.decision.decision));
    assert.ok(result.decision.reason);
    assert.equal(typeof result.decision.confidence, 'number');
  });
});

/* ── 2. Full Pipeline: Mission → Assessment → Decision ──────────── */

describe('Full Pipeline: Mission → Assessment → Decision', () => {
  it('high-quality mission produces STOP_PASS decision', () => {
    const session = mockSession({
      status: 'done',
      findings: [],
      capturedSteps: Array.from({ length: 40 }, (_, i) => ({ url: `/page${i}` })),
      activities: Array.from({ length: 40 }, (_, i) => ({ id: `a${i}` }))
    });
    const evidence = {
      missionResult: {
        quality: {
          score: 95,
          verdict: 'pass',
          releaseReady: true,
          confidence: 0.95,
          risk: 'low',
          criticalIssues: [],
          recommendations: [],
          breakdown: {}
        }
      }
    };
    const decision = makeDecision(session, evidence, mockMission());

    assert.equal(decision.decision, DECISION_TYPES.STOP_PASS);
    assert.ok(decision.confidence >= 0.5);
    assert.ok(decision.reason.includes('sufficient') || decision.reason.includes('acceptable'));
  });

  it('critical-finding mission produces STOP_FAIL decision', () => {
    const session = mockSession({
      status: 'done',
      findings: [
        { id: 'f1', title: 'Auth bypass', severity: 'critical', confidence: 0.9, isDuplicate: false }
      ],
      capturedSteps: Array.from({ length: 30 }, (_, i) => ({ url: `/page${i}` })),
      activities: Array.from({ length: 30 }, (_, i) => ({ id: `a${i}` }))
    });
    const evidence = {
      missionResult: {
        quality: {
          score: 20,
          verdict: 'fail',
          releaseReady: false,
          confidence: 0.4,
          risk: 'high',
          criticalIssues: [{ title: 'Auth bypass', severity: 'critical' }],
          recommendations: [],
          breakdown: { critical: 1 }
        }
      }
    };
    const decision = makeDecision(session, evidence, mockMission());

    assert.equal(decision.decision, DECISION_TYPES.STOP_FAIL);
    assert.ok(decision.evidenceRefs.includes('f1'));
  });

  it('insufficient coverage mission produces REVALIDATE decision', () => {
    const session = mockSession({
      status: 'done',
      findings: [],
      capturedSteps: [{ url: '/home' }], // Very few steps
      activities: [{ id: 'a1' }]
    });
    const evidence = {
      missionResult: {
        quality: {
          score: 100,
          verdict: 'pass',
          releaseReady: true,
          confidence: 1.0,
          risk: 'low',
          criticalIssues: [],
          recommendations: [],
          breakdown: {}
        }
      }
    };
    const decision = makeDecision(session, evidence, mockMission());

    assert.equal(decision.decision, DECISION_TYPES.REVALIDATE);
    assert.ok(decision.reason.includes('insufficient') || decision.reason.includes('coverage'));
  });

  it('budget-exhausted mission produces STOP_BUDGET decision', () => {
    const session = mockSession({
      status: 'running',
      findings: [],
      capturedSteps: [],
      activities: [],
      startedAt: Date.now() - 20 * 60 * 1000 // 20 min ago
    });
    const mission = mockMission({ constraints: { maxDurationMs: 600000, maxActions: 5 } });
    const evidence = { missionResult: null };
    const decision = makeDecision(session, evidence, mission);

    assert.equal(decision.decision, DECISION_TYPES.STOP_BUDGET);
  });
});

/* ── 3. Knowledge Conflict Integration ──────────────────────────── */

describe('Knowledge Conflict Integration', () => {
  it('knowledge conflicts trigger REVALIDATE in completed session', () => {
    const session = mockSession({
      status: 'done',
      findings: [{ id: 'f1', title: 'Login works', severity: 'low', confidence: 0.8, isDuplicate: false }],
      capturedSteps: Array.from({ length: 35 }, (_, i) => ({ url: `/page${i}` })),
      activities: Array.from({ length: 35 }, (_, i) => ({ id: `a${i}` }))
    });
    const evidence = {
      missionResult: {
        quality: {
          score: 80,
          verdict: 'pass_with_issues',
          releaseReady: true,
          confidence: 0.8,
          risk: 'low',
          criticalIssues: [],
          recommendations: [],
          breakdown: { low: 1 }
        }
      },
      knowledgeConflicts: [
        { patternId: 'kp1', resolution: 'current_evidence_wins' }
      ],
      knowledgeValidation: [
        { id: 'kp1', status: 'contradicted' }
      ]
    };
    const decision = makeDecision(session, evidence, mockMission());

    assert.equal(decision.decision, DECISION_TYPES.REVALIDATE);
    assert.ok(decision.factors.knowledgeConflicts >= 1);
  });

  it('current evidence wins over historical knowledge in decision', () => {
    // Historical knowledge says "login broken" but current evidence shows "login works"
    const session = mockSession({
      status: 'done',
      findings: [{ id: 'f1', title: 'Login works correctly', severity: 'info', confidence: 0.9, isDuplicate: false }],
      capturedSteps: Array.from({ length: 35 }, (_, i) => ({ url: `/page${i}` })),
      activities: Array.from({ length: 35 }, (_, i) => ({ id: `a${i}` }))
    });
    const evidence = {
      missionResult: {
        quality: {
          score: 95,
          verdict: 'pass',
          releaseReady: true,
          confidence: 0.95,
          risk: 'low',
          criticalIssues: [],
          recommendations: [],
          breakdown: { info: 1 }
        }
      },
      knowledgeConflicts: [
        { patternId: 'kp_login_broken', historicalClaim: 'login is broken', currentEvidence: 'login works', resolution: 'current_evidence_wins' }
      ],
      knowledgeValidation: [
        { id: 'kp_login_broken', status: 'contradicted' }
      ]
    };
    const decision = makeDecision(session, evidence, mockMission());

    // Decision should NOT be STOP_FAIL despite historical knowledge saying login is broken
    assert.notEqual(decision.decision, DECISION_TYPES.STOP_FAIL);
    // Should be REVALIDATE (to confirm the contradiction)
    assert.equal(decision.decision, DECISION_TYPES.REVALIDATE);
  });
});

/* ── 4. Decision History Accumulation ───────────────────────────── */

describe('Decision History Accumulation', () => {
  it('multiple decisions accumulate in bounded history', () => {
    const session = mockSession({
      status: 'running',
      findings: [],
      capturedSteps: [{ url: '/p' }],
      activities: [{ id: 'a1' }]
    });
    const mission = mockMission();
    const evidence = { missionResult: null };

    // Make decision, then change state, then make another
    makeDecision(session, evidence, mission);

    session.findings = [{ id: 'f1', title: 'Critical bug', severity: 'critical', confidence: 0.9, isDuplicate: false }];
    session.status = 'done';
    const evidence2 = {
      missionResult: {
        quality: {
          score: 20,
          verdict: 'fail',
          releaseReady: false,
          confidence: 0.4,
          risk: 'high',
          criticalIssues: [{ title: 'Critical bug' }],
          recommendations: [],
          breakdown: { critical: 1 }
        }
      }
    };
    makeDecision(session, evidence2, mission);

    assert.equal(session.decisionHistory.length, 2);
    assert.notEqual(session.decisionHistory[0].decision, session.decisionHistory[1].decision);
  });

  it('decision history includes timestamps for auditability', () => {
    const session = mockSession({
      status: 'running',
      findings: [],
      capturedSteps: [{ url: '/p' }],
      activities: [{ id: 'a1' }]
    });

    makeDecision(session, { missionResult: null }, mockMission());

    assert.ok(session.decisionHistory[0].timestamp);
    assert.ok(!isNaN(Date.parse(session.decisionHistory[0].timestamp)));
  });
});

/* ── 5. Decision Isolation from Evidence ────────────────────────── */

describe('Decision Isolation', () => {
  it('decision object does not carry raw evidence data', () => {
    const session = mockSession({
      status: 'done',
      findings: [
        { id: 'f1', title: 'Bug', severity: 'high', confidence: 0.8, isDuplicate: false,
          sensitiveData: 'should-not-leak', screenshot: 'base64data...' }
      ],
      capturedSteps: Array.from({ length: 35 }, (_, i) => ({ url: `/page${i}` })),
      activities: Array.from({ length: 35 }, (_, i) => ({ id: `a${i}` }))
    });
    const evidence = {
      missionResult: {
        quality: {
          score: 30,
          verdict: 'fail',
          releaseReady: false,
          confidence: 0.4,
          risk: 'high',
          criticalIssues: [],
          recommendations: [],
          breakdown: { high: 1 }
        }
      }
    };
    const decision = makeDecision(session, evidence, mockMission());

    // Decision should reference evidence by ID, not carry the raw data
    assert.ok(!JSON.stringify(decision).includes('sensitiveData'));
    assert.ok(!JSON.stringify(decision).includes('base64data'));
    assert.ok(!JSON.stringify(decision).includes('screenshot'));
  });
});
