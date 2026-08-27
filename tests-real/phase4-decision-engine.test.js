/**
 * Phase 4 — Decision Engine Unit Tests
 *
 * Tests every decision type, policy evaluation, confidence calculation,
 * budget handling, safety overrides, idempotency, history, and security.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDecision,
  makeDecision,
  makeDecisionSafe,
  evaluatePolicy,
  collectDecisionInput,
  computeDecisionConfidence,
  computeInputSignature,
  checkIdempotency,
  applySafetyOverride,
  trackBudget,
  computeBudgetRemaining,
  formatBudgetRemaining,
  getDecisionHistory,
  appendDecision,
  getLastDecision,
  safeFallback,
  sanitizeText,
  DECISION_TYPES,
  TERMINAL_DECISIONS,
  VALID_DECISION_TYPES,
  POLICY_VERSION,
  DEFAULT_BUDGET,
  BUDGET_CRITICAL_THRESHOLD,
  MAX_DECISION_HISTORY
} from '../server/decisionEngine.js';

/* ── Helper: create a mock session ──────────────────────────────── */

function mockSession(overrides = {}) {
  return {
    id: 'test-session-' + Math.random().toString(36).slice(2, 8),
    findings: [],
    activities: [],
    capturedSteps: [],
    status: 'running',
    startedAt: Date.now() - 60000, // 1 min ago
    decisionHistory: [],
    ...overrides
  };
}

function mockMission(overrides = {}) {
  return {
    id: 'test-mission-' + Math.random().toString(36).slice(2, 8),
    type: 'qa',
    constraints: {},
    ...overrides
  };
}

function mockFinding(severity, opts = {}) {
  return {
    id: 'finding-' + Math.random().toString(36).slice(2, 8),
    title: opts.title || `${severity} issue found`,
    severity,
    confidence: opts.confidence ?? 0.8,
    isDuplicate: false,
    ...opts
  };
}

function mockEvidence(overrides = {}) {
  return {
    missionResult: {
      quality: {
        score: 100,
        verdict: 'pass',
        releaseReady: true,
        confidence: 0.9,
        risk: 'low',
        criticalIssues: [],
        recommendations: [],
        breakdown: {}
      }
    },
    ...overrides
  };
}

/* ── 1. Decision Contract ───────────────────────────────────────── */

describe('Decision Contract — createDecision()', () => {
  it('creates a valid decision with all required fields', () => {
    const d = createDecision({
      decision: DECISION_TYPES.CONTINUE,
      reason: 'Evidence coverage is insufficient for a terminal decision.',
      confidence: 0.65,
      factors: { coverage: 0.42 },
      missionId: 'm1',
      sessionId: 's1'
    });

    assert.equal(d.decision, 'CONTINUE');
    assert.ok(d.reason.length > 10);
    assert.equal(d.confidence, 0.65);
    assert.ok(d.id.startsWith('dec_'));
    assert.ok(d.timestamp);
    assert.equal(d.policyVersion, POLICY_VERSION);
    assert.equal(d.missionId, 'm1');
    assert.equal(d.sessionId, 's1');
    assert.ok(Array.isArray(d.evidenceRefs));
    assert.ok(Array.isArray(d.knowledgeRefs));
  });

  it('rejects invalid decision type', () => {
    assert.throws(
      () => createDecision({ decision: 'INVALID_TYPE', reason: 'some reason here', confidence: 0.5 }),
      /Invalid decision type/
    );
  });

  it('rejects missing or short reason', () => {
    assert.throws(
      () => createDecision({ decision: 'CONTINUE', reason: 'short', confidence: 0.5 }),
      /meaningful reason/
    );
    assert.throws(
      () => createDecision({ decision: 'CONTINUE', reason: '', confidence: 0.5 }),
      /meaningful reason/
    );
  });

  it('clamps confidence to [0, 1]', () => {
    const d1 = createDecision({ decision: 'CONTINUE', reason: 'valid reason here', confidence: 1.5 });
    const d2 = createDecision({ decision: 'CONTINUE', reason: 'valid reason here', confidence: -0.5 });
    assert.equal(d1.confidence, 1);
    assert.equal(d2.confidence, 0);
  });

  it('sanitizes reason text (strips HTML)', () => {
    const d = createDecision({
      decision: 'CONTINUE',
      reason: '<script>alert(1)</script>Evidence is insufficient for a pass',
      confidence: 0.5
    });
    assert.ok(!d.reason.includes('<script>'));
    assert.ok(!d.reason.includes('<'));
  });

  it('allows all 7 decision types', () => {
    for (const type of Object.values(DECISION_TYPES)) {
      const d = createDecision({ decision: type, reason: 'reason for the decision here', confidence: 0.5 });
      assert.equal(d.decision, type);
    }
  });
});

/* ── 2. Decision Types ──────────────────────────────────────────── */

describe('Decision Types', () => {
  it('has exactly 9 decision types', () => {
    // C2: INVESTIGATE + REPLAN added to the vocabulary (non-terminal,
    // iteration-continuing verbs with different focus).
    assert.equal(Object.keys(DECISION_TYPES).length, 9);
    assert.ok(DECISION_TYPES.INVESTIGATE);
    assert.ok(DECISION_TYPES.REPLAN);
  });

  it('terminal decisions are STOP_*', () => {
    assert.ok(TERMINAL_DECISIONS.has(DECISION_TYPES.STOP_PASS));
    assert.ok(TERMINAL_DECISIONS.has(DECISION_TYPES.STOP_FAIL));
    assert.ok(TERMINAL_DECISIONS.has(DECISION_TYPES.STOP_BUDGET));
    assert.ok(TERMINAL_DECISIONS.has(DECISION_TYPES.STOP_BLOCKED));
    assert.ok(!TERMINAL_DECISIONS.has(DECISION_TYPES.CONTINUE));
    assert.ok(!TERMINAL_DECISIONS.has(DECISION_TYPES.REVALIDATE));
    assert.ok(!TERMINAL_DECISIONS.has(DECISION_TYPES.ESCALATE));
  });

  it('validates against allowlist', () => {
    assert.ok(VALID_DECISION_TYPES.has('CONTINUE'));
    assert.ok(!VALID_DECISION_TYPES.has('RANDOM'));
  });
});

/* ── 3. Confidence Model ────────────────────────────────────────── */

describe('Confidence Model — computeDecisionConfidence()', () => {
  it('returns 0 with no signals', () => {
    const result = computeDecisionConfidence({});
    assert.equal(result.value, 0);
    assert.ok(result.basis.length > 0);
  });

  it('weights evidence completeness at 25%', () => {
    const result = computeDecisionConfidence({ evidenceCompleteness: 0.8 });
    // Only 1 signal → weight redistributed + 0.85 penalty
    // 0.8 * (0.25/0.25) * 0.85 = 0.68
    assert.ok(result.value > 0.5);
    assert.ok(result.value < 0.85);
  });

  it('combines multiple signals', () => {
    const result = computeDecisionConfidence({
      evidenceCompleteness: 0.8,
      findingConfidence: 0.7,
      understandingConfidence: 0.6,
      qualityScore: 75,
      knowledgeAgreement: 0.9
    });
    // 5 signals, all decent → should be around 0.72-0.78
    assert.ok(result.value > 0.6);
    assert.ok(result.value < 0.9);
  });

  it('penalizes when fewer than 3 signals', () => {
    const one = computeDecisionConfidence({ evidenceCompleteness: 0.9 });
    const multi = computeDecisionConfidence({
      evidenceCompleteness: 0.9,
      findingConfidence: 0.9,
      understandingConfidence: 0.9
    });
    // Multi should be higher because no penalty
    assert.ok(multi.value > one.value, `multi (${multi.value}) should be > one (${one.value})`);
  });

  it('normalizes qualityScore from 0-100 to 0-1', () => {
    const result = computeDecisionConfidence({ qualityScore: 50 });
    // 50/100 = 0.5, single signal with penalty: 0.5 * 0.85 = 0.425
    assert.ok(result.value < 0.5);
  });

  it('basis array contains human-readable explanation', () => {
    const result = computeDecisionConfidence({ evidenceCompleteness: 0.42 });
    assert.ok(result.basis.some(b => b.includes('42%')));
  });
});

/* ── 4. Budget Model ────────────────────────────────────────────── */

describe('Budget Model', () => {
  it('initializes budget with defaults on first call', () => {
    const session = mockSession();
    const mission = mockMission();
    const budget = trackBudget(session, mission);

    assert.ok(budget.limits);
    assert.equal(budget.limits.timeMs, DEFAULT_BUDGET.timeMs);
    assert.equal(budget.limits.actions, DEFAULT_BUDGET.actions);
  });

  it('reads custom limits from mission constraints', () => {
    const session = mockSession();
    const mission = mockMission({ constraints: { maxDurationMs: 60000, maxActions: 10 } });
    const budget = trackBudget(session, mission);

    assert.equal(budget.limits.timeMs, 60000);
    assert.equal(budget.limits.actions, 10);
  });

  it('computes remaining budget correctly', () => {
    const budget = {
      timeUsed: 75000, // 1.25 min used of 15 min
      actionsUsed: 25,
      browserInteractionsUsed: 50,
      llmCallsUsed: 25,
      limits: { timeMs: 900000, actions: 50, browserInteractions: 200, llmCalls: 60 }
    };
    const remaining = computeBudgetRemaining(budget);

    assert.ok(remaining.time > 0.9);
    assert.equal(remaining.actions, 0.5);
    assert.equal(remaining.browser, 0.75);
    assert.ok(remaining.overall > 0);
    assert.ok(remaining.overall <= 1);
  });

  it('returns full budget when no consumption tracked', () => {
    const remaining = computeBudgetRemaining(null);
    assert.equal(remaining.overall, 1);
  });

  it('formatBudgetRemaining produces human-readable strings', () => {
    const remaining = { time: 0.5, actions: 0.75, browser: 1.0, llm: 0.3, overall: 0.3 };
    const formatted = formatBudgetRemaining(remaining);
    assert.equal(formatted.time, '50%');
    assert.equal(formatted.actions, '75%');
    assert.equal(formatted.overall, '30%');
  });

  it('budget exhausted when limits exceeded', () => {
    const budget = {
      timeUsed: 1000000,
      actionsUsed: 100,
      browserInteractionsUsed: 300,
      llmCallsUsed: 100,
      limits: { timeMs: 900000, actions: 50, browserInteractions: 200, llmCalls: 60 }
    };
    const remaining = computeBudgetRemaining(budget);
    assert.equal(remaining.overall, 0);
  });
});

/* ── 5. Decision History ────────────────────────────────────────── */

describe('Decision History', () => {
  it('appends decisions to session', () => {
    const session = mockSession();
    const d1 = createDecision({ decision: 'CONTINUE', reason: 'first decision reason', confidence: 0.5 });
    const d2 = createDecision({ decision: 'ESCALATE', reason: 'second decision reason', confidence: 0.7 });

    appendDecision(session, d1);
    appendDecision(session, d2);

    assert.equal(session.decisionHistory.length, 2);
    assert.equal(getLastDecision(session).decision, 'ESCALATE');
  });

  it('bounds history to MAX_DECISION_HISTORY', () => {
    const session = mockSession();
    for (let i = 0; i < MAX_DECISION_HISTORY + 50; i++) {
      appendDecision(session, createDecision({
        decision: 'CONTINUE',
        reason: `decision number ${i} with sufficient text`,
        confidence: 0.5
      }));
    }
    assert.equal(session.decisionHistory.length, MAX_DECISION_HISTORY);
    // Most recent should be the last appended (highest number)
    const last = session.decisionHistory[session.decisionHistory.length - 1];
    assert.ok(last.reason.includes('149'), `expected last reason to be #149, got: ${last.reason}`);
  });

  it('getDecisionHistory initializes if absent', () => {
    const session = { id: 'test' };
    const history = getDecisionHistory(session);
    assert.ok(Array.isArray(history));
    assert.equal(history.length, 0);
  });
});

/* ── 6. Idempotency ─────────────────────────────────────────────── */

describe('Idempotency', () => {
  it('same inputs produce same signature', () => {
    const input1 = { qualityScore: 50, verdict: 'fail', findingCount: 3, criticalCount: 1 };
    const input2 = { qualityScore: 50, verdict: 'fail', findingCount: 3, criticalCount: 1 };
    assert.equal(computeInputSignature(input1), computeInputSignature(input2));
  });

  it('different inputs produce different signatures', () => {
    const input1 = { qualityScore: 50, findingCount: 3 };
    const input2 = { qualityScore: 90, findingCount: 3 };
    assert.notEqual(computeInputSignature(input1), computeInputSignature(input2));
  });

  it('makeDecision returns cached decision for same inputs', () => {
    const session = mockSession({
      status: 'done',
      findings: [mockFinding('medium')],
      capturedSteps: Array.from({ length: 10 }, (_, i) => ({ url: `/page${i}` }))
    });
    const evidence = mockEvidence({
      missionResult: { quality: { score: 60, verdict: 'pass_with_issues', releaseReady: true, confidence: 0.7, risk: 'low', criticalIssues: [], recommendations: [], breakdown: { medium: 1 } } }
    });
    const mission = mockMission();

    const d1 = makeDecision(session, evidence, mission);
    const d2 = makeDecision(session, evidence, mission);

    // Second call should return the cached decision (same id)
    assert.equal(d1.id, d2.id);
    // History should only have 1 entry (idempotency prevents duplicate)
    assert.equal(session.decisionHistory.length, 1);
  });

  it('different inputs produce new decision', () => {
    const session = mockSession({
      status: 'done',
      findings: [mockFinding('medium')],
      capturedSteps: Array.from({ length: 10 }, () => ({ url: '/page' }))
    });
    const mission = mockMission();

    // First decision
    const ev1 = mockEvidence({ missionResult: { quality: { score: 60, verdict: 'pass_with_issues', releaseReady: true, confidence: 0.7, risk: 'low', criticalIssues: [], recommendations: [], breakdown: { medium: 1 } } } });
    makeDecision(session, ev1, mission);

    // Change inputs — new finding with critical severity
    session.findings.push(mockFinding('critical'));
    const ev2 = mockEvidence({ missionResult: { quality: { score: 30, verdict: 'fail', releaseReady: false, confidence: 0.5, risk: 'high', criticalIssues: [{ title: 'test' }], recommendations: [], breakdown: { critical: 1, medium: 1 } } } });
    const d2 = makeDecision(session, ev2, mission);

    assert.notEqual(session.decisionHistory[0].id, d2.id);
    assert.equal(session.decisionHistory.length, 2);
  });
});

/* ── 7. Safety Overrides ────────────────────────────────────────── */

describe('Safety Overrides', () => {
  it('blocks STOP_PASS when confidence < 0.60', () => {
    const decision = createDecision({
      decision: DECISION_TYPES.STOP_PASS,
      reason: 'Everything looks fine, passing the mission here.',
      confidence: 0.45,
      factors: {}
    });
    const input = { evidenceCompleteness: 0.8, criticalCount: 0 };

    const override = applySafetyOverride(decision, input);
    assert.ok(override);
    assert.equal(override.decision, DECISION_TYPES.CONTINUE);
    assert.equal(override.factors.safetyOverride, 'low_confidence_blocks_pass');
  });

  it('blocks STOP_PASS when evidence completeness < 50%', () => {
    const decision = createDecision({
      decision: DECISION_TYPES.STOP_PASS,
      reason: 'Mission passed with good results overall.',
      confidence: 0.80,
      factors: {}
    });
    const input = { evidenceCompleteness: 0.35, criticalCount: 0 };

    const override = applySafetyOverride(decision, input);
    assert.ok(override);
    assert.equal(override.decision, DECISION_TYPES.CONTINUE);
    assert.equal(override.factors.safetyOverride, 'insufficient_evidence_blocks_pass');
  });

  it('blocks STOP_PASS when critical findings exist', () => {
    const decision = createDecision({
      decision: DECISION_TYPES.STOP_PASS,
      reason: 'Mission looks good, recommending a pass.',
      confidence: 0.85,
      factors: {}
    });
    const input = { evidenceCompleteness: 0.8, criticalCount: 1 };

    const override = applySafetyOverride(decision, input);
    assert.ok(override);
    assert.equal(override.decision, DECISION_TYPES.STOP_FAIL);
    assert.equal(override.factors.safetyOverride, 'critical_findings_block_pass');
  });

  it('blocks STOP_PASS when agent is awaiting input', () => {
    const decision = createDecision({
      decision: DECISION_TYPES.STOP_PASS,
      reason: 'Mission looks good, recommending a pass here.',
      confidence: 0.85,
      factors: {}
    });
    const input = { evidenceCompleteness: 0.8, criticalCount: 0, awaitingInput: true };

    const override = applySafetyOverride(decision, input);
    assert.ok(override);
    assert.equal(override.decision, DECISION_TYPES.ESCALATE);
  });

  it('allows STOP_PASS when all safety checks pass', () => {
    const decision = createDecision({
      decision: DECISION_TYPES.STOP_PASS,
      reason: 'All clear, mission passed successfully here.',
      confidence: 0.85,
      factors: {}
    });
    const input = { evidenceCompleteness: 0.8, criticalCount: 0, awaitingInput: false };

    const override = applySafetyOverride(decision, input);
    assert.equal(override, null);
  });
});

/* ── 8. Policy Evaluation — All Decision Types ──────────────────── */

describe('Policy Evaluation — Decision Scenarios', () => {

  // Scenario 1: No findings + insufficient coverage → CONTINUE
  it('Scenario 1: no findings + insufficient coverage → CONTINUE', () => {
    const session = mockSession({
      status: 'running',
      findings: [],
      capturedSteps: [{ url: '/home' }], // 1 step → very low coverage
      activities: [{ id: 'a1' }]
    });
    const evidence = mockEvidence({ missionResult: null });
    const mission = mockMission();
    const input = collectDecisionInput(session, evidence, mission);

    const decision = evaluatePolicy(input, session);
    assert.equal(decision.decision, DECISION_TYPES.CONTINUE);
  });

  // Scenario 2: Critical confirmed finding → STOP_FAIL
  it('Scenario 2: critical confirmed finding + completed session → STOP_FAIL', () => {
    const session = mockSession({
      status: 'done',
      findings: [mockFinding('critical', { confidence: 0.9 })],
      capturedSteps: Array.from({ length: 35 }, (_, i) => ({ url: `/page${i}` })),
      activities: Array.from({ length: 35 }, (_, i) => ({ id: `a${i}` }))
    });
    const evidence = mockEvidence({
      missionResult: { quality: { score: 30, verdict: 'fail', releaseReady: false, confidence: 0.5, risk: 'high', criticalIssues: [{ title: 'test' }], recommendations: [], breakdown: { critical: 1 } } }
    });
    const mission = mockMission();
    const input = collectDecisionInput(session, evidence, mission);

    const decision = evaluatePolicy(input, session);
    assert.equal(decision.decision, DECISION_TYPES.STOP_FAIL);
  });

  // Scenario 3: Conflicting evidence → REVALIDATE
  it('Scenario 3: knowledge conflicts with current evidence → REVALIDATE', () => {
    const session = mockSession({
      status: 'done',
      findings: [mockFinding('medium')],
      capturedSteps: Array.from({ length: 35 }, (_, i) => ({ url: `/page${i}` })),
      activities: Array.from({ length: 35 }, (_, i) => ({ id: `a${i}` }))
    });
    const evidence = mockEvidence({
      missionResult: { quality: { score: 70, verdict: 'pass_with_issues', releaseReady: true, confidence: 0.7, risk: 'medium', criticalIssues: [], recommendations: [], breakdown: { medium: 1 } } },
      knowledgeConflicts: [
        { patternId: 'kp1', historicalClaim: 'login broken', currentEvidence: 'login works', resolution: 'current_evidence_wins' }
      ],
      knowledgeValidation: [
        { id: 'kp1', status: 'contradicted' }
      ]
    });
    const mission = mockMission();
    const input = collectDecisionInput(session, evidence, mission);

    const decision = evaluatePolicy(input, session);
    assert.equal(decision.decision, DECISION_TYPES.REVALIDATE);
  });

  // Scenario 4: High confidence + sufficient coverage + no blockers → STOP_PASS
  it('Scenario 4: high confidence + sufficient coverage + no blockers → STOP_PASS', () => {
    const session = mockSession({
      status: 'done',
      findings: [], // no findings
      capturedSteps: Array.from({ length: 40 }, (_, i) => ({ url: `/page${i}` })),
      activities: Array.from({ length: 40 }, (_, i) => ({ id: `a${i}` }))
    });
    const evidence = mockEvidence({
      missionResult: { quality: { score: 100, verdict: 'pass', releaseReady: true, confidence: 1.0, risk: 'low', criticalIssues: [], recommendations: [], breakdown: {} } }
    });
    const mission = mockMission();
    const input = collectDecisionInput(session, evidence, mission);

    const decision = evaluatePolicy(input, session);
    // Score >= 85, evidence >= 0.5, no criticals → STOP_PASS
    assert.equal(decision.decision, DECISION_TYPES.STOP_PASS);
  });

  // Scenario 5: Budget exhausted → STOP_BUDGET
  it('Scenario 5: budget exhausted → STOP_BUDGET', () => {
    const session = mockSession({
      status: 'running',
      findings: [],
      capturedSteps: Array.from({ length: 5 }, (_, i) => ({ url: `/page${i}` })),
      activities: Array.from({ length: 5 }, (_, i) => ({ id: `a${i}` })),
      startedAt: Date.now() - 20 * 60 * 1000 // 20 min ago (over 15 min default)
    });
    const evidence = mockEvidence({ missionResult: null });
    const mission = mockMission({ constraints: { maxDurationMs: 15 * 60 * 1000, maxActions: 5 } });
    const input = collectDecisionInput(session, evidence, mission);

    const decision = evaluatePolicy(input, session);
    assert.equal(decision.decision, DECISION_TYPES.STOP_BUDGET);
  });

  // Scenario 6: Agent blocked (error state) → STOP_BLOCKED
  it('Scenario 6: agent in error state → STOP_BLOCKED', () => {
    const session = mockSession({
      status: 'error',
      findings: [],
      capturedSteps: [],
      activities: []
    });
    const evidence = mockEvidence({ missionResult: null });
    const mission = mockMission();
    const input = collectDecisionInput(session, evidence, mission);

    const decision = evaluatePolicy(input, session);
    assert.equal(decision.decision, DECISION_TYPES.STOP_BLOCKED);
  });

  // Scenario 7: Awaiting input → ESCALATE
  it('Scenario 7: agent awaiting input → ESCALATE', () => {
    const session = mockSession({
      status: 'awaiting_input',
      findings: [],
      capturedSteps: [{ url: '/page' }],
      activities: [{ id: 'a1' }]
    });
    const evidence = mockEvidence({ missionResult: null });
    const mission = mockMission();
    const input = collectDecisionInput(session, evidence, mission);

    const decision = evaluatePolicy(input, session);
    assert.equal(decision.decision, DECISION_TYPES.ESCALATE);
  });

  // Scenario 8: Mid-mission critical with high confidence → ESCALATE
  it('Scenario 8: mid-mission critical finding → ESCALATE', () => {
    const session = mockSession({
      status: 'running',
      findings: [mockFinding('critical', { confidence: 0.85 })],
      capturedSteps: Array.from({ length: 10 }, (_, i) => ({ url: `/page${i}` })),
      activities: Array.from({ length: 10 }, (_, i) => ({ id: `a${i}` }))
    });
    const evidence = mockEvidence({
      missionResult: { quality: { score: 40, verdict: 'fail', releaseReady: false, confidence: 0.5, risk: 'high', criticalIssues: [{ title: 'test' }], recommendations: [], breakdown: { critical: 1 } } }
    });
    const mission = mockMission();
    const input = collectDecisionInput(session, evidence, mission);

    const decision = evaluatePolicy(input, session);
    assert.equal(decision.decision, DECISION_TYPES.ESCALATE);
  });

  // Scenario 9: Session done with pass_with_issues → STOP_PASS
  it('Scenario 9: session done with pass_with_issues → STOP_PASS', () => {
    const session = mockSession({
      status: 'done',
      findings: [mockFinding('medium', { confidence: 0.6 })],
      capturedSteps: Array.from({ length: 35 }, (_, i) => ({ url: `/page${i}` })),
      activities: Array.from({ length: 35 }, (_, i) => ({ id: `a${i}` }))
    });
    const evidence = mockEvidence({
      missionResult: { quality: { score: 70, verdict: 'pass_with_issues', releaseReady: true, confidence: 0.7, risk: 'medium', criticalIssues: [], recommendations: [], breakdown: { medium: 1 } } }
    });
    const mission = mockMission();
    const input = collectDecisionInput(session, evidence, mission);

    const decision = evaluatePolicy(input, session);
    assert.equal(decision.decision, DECISION_TYPES.STOP_PASS);
  });

  // Scenario 10: Session done, insufficient evidence, budget remains → REVALIDATE
  it('Scenario 10: completed but insufficient coverage + budget → REVALIDATE', () => {
    const session = mockSession({
      status: 'done',
      findings: [],
      capturedSteps: [{ url: '/page' }], // 1 step → 0.03 completeness
      activities: [{ id: 'a1' }]
    });
    const evidence = mockEvidence({
      missionResult: { quality: { score: 100, verdict: 'pass', releaseReady: true, confidence: 1.0, risk: 'low', criticalIssues: [], recommendations: [], breakdown: {} } }
    });
    const mission = mockMission();
    const input = collectDecisionInput(session, evidence, mission);

    const decision = evaluatePolicy(input, session);
    // Evidence completeness is ~3%, below 50%. C2 vocabulary: with no
    // findings, barely any steps, and budget remaining this is CONTINUE
    // (same approach, keep going) — REVALIDATE is reserved for conflicting
    // evidence; the old blanket 'revalidate on low coverage' became CONTINUE.
    assert.equal(decision.decision, DECISION_TYPES.CONTINUE);
  });

  // Scenario 11: Completed session, score < 60, no criticals → STOP_FAIL
  it('Scenario 11: completed with fail verdict → STOP_FAIL', () => {
    const session = mockSession({
      status: 'done',
      findings: [
        mockFinding('high', { confidence: 0.8 }),
        mockFinding('high', { confidence: 0.7 }),
        mockFinding('medium', { confidence: 0.6 })
      ],
      capturedSteps: Array.from({ length: 35 }, (_, i) => ({ url: `/page${i}` })),
      activities: Array.from({ length: 35 }, (_, i) => ({ id: `a${i}` }))
    });
    const evidence = mockEvidence({
      mission: { quality: { score: 40, verdict: 'fail', releaseReady: false, confidence: 0.5, risk: 'high', criticalIssues: [], recommendations: [], breakdown: { high: 2, medium: 1 } } },
      missionResult: { quality: { score: 40, verdict: 'fail', releaseReady: false, confidence: 0.5, risk: 'high', criticalIssues: [], recommendations: [], breakdown: { high: 2, medium: 1 } } }
    });
    const mission = mockMission();
    const input = collectDecisionInput(session, evidence, mission);

    const decision = evaluatePolicy(input, session);
    assert.equal(decision.decision, DECISION_TYPES.STOP_FAIL);
  });
});

/* ── 9. Safe Fallback ───────────────────────────────────────────── */

describe('Safe Fallback', () => {
  it('returns ESCALATE decision on engine error', () => {
    const error = new Error('Something went wrong in the decision engine');
    const session = mockSession();
    const mission = mockMission();
    const decision = safeFallback(error, session, mission);

    assert.equal(decision.decision, DECISION_TYPES.ESCALATE);
    assert.equal(decision.confidence, 0);
    assert.ok(decision.reason.includes('Something went wrong'));
    assert.ok(decision.factors.error);
    assert.ok(decision.factors.fallbackReason);
  });

  it('records fallback to history', () => {
    const error = new Error('Test error');
    const session = mockSession();
    safeFallback(error, session);

    assert.equal(session.decisionHistory.length, 1);
    assert.equal(session.decisionHistory[0].decision, 'ESCALATE');
  });

  it('makeDecisionSafe wraps errors gracefully', () => {
    // Pass something that will cause collectDecisionInput to produce an error in evaluatePolicy
    // Actually makeDecisionSafe should handle internal errors — test with a null session
    const decision = makeDecisionSafe(null, {}, null);
    assert.equal(decision.decision, DECISION_TYPES.ESCALATE);
    assert.ok(decision.factors?.error);
  });
});

/* ── 10. Security — Sanitization ────────────────────────────────── */

describe('Security — sanitizeText()', () => {
  it('strips HTML/script tags', () => {
    const result = sanitizeText('<script>alert(1)</script>hello');
    assert.ok(!result.includes('<'));
    assert.ok(result.includes('hello'));
  });

  it('removes control characters', () => {
    const result = sanitizeText('hello\x00\x01\x02world');
    assert.ok(!result.includes('\x00'));
    assert.ok(result.includes('hello'));
  });

  it('limits to 1000 chars', () => {
    const long = 'A'.repeat(2000);
    const result = sanitizeText(long);
    assert.equal(result.length, 1000);
  });

  it('returns empty string for non-string input', () => {
    assert.equal(sanitizeText(123), '');
    assert.equal(sanitizeText(null), '');
    assert.equal(sanitizeText(undefined), '');
  });
});

/* ── 11. Invalid/Missing Inputs ─────────────────────────────────── */

describe('Invalid Inputs', () => {
  it('handles empty session findings', () => {
    const session = mockSession({ findings: [], status: 'running', capturedSteps: [], activities: [] });
    const evidence = mockEvidence({ missionResult: null });
    const decision = makeDecision(session, evidence, mockMission());

    // Empty session, running → CONTINUE (or STOP_BLOCKED if error)
    assert.ok([DECISION_TYPES.CONTINUE, DECISION_TYPES.STOP_BUDGET].includes(decision.decision));
  });

  it('handles missing quality assessment', () => {
    const session = mockSession({ status: 'done', findings: [], capturedSteps: Array.from({ length: 10 }, (_, i) => ({ url: `/p${i}` })) });
    const evidence = {}; // no missionResult
    const decision = makeDecision(session, evidence, mockMission());

    assert.ok(VALID_DECISION_TYPES.has(decision.decision));
  });

  it('handles null mission', () => {
    const session = mockSession({ status: 'done', findings: [], capturedSteps: Array.from({ length: 10 }, (_, i) => ({ url: `/p${i}` })) });
    const evidence = mockEvidence();
    const decision = makeDecision(session, evidence, null);

    assert.ok(VALID_DECISION_TYPES.has(decision.decision));
    assert.equal(decision.missionId, null);
  });
});

/* ── 12. Auditability ───────────────────────────────────────────── */

describe('Auditability', () => {
  it('every decision has a reason', () => {
    const session = mockSession({ status: 'running', findings: [], capturedSteps: [{ url: '/p' }], activities: [{ id: 'a1' }] });
    const decision = makeDecision(session, mockEvidence({ missionResult: null }), mockMission());

    assert.ok(decision.reason.length >= 10);
    assert.ok(typeof decision.reason === 'string');
  });

  it('every decision has a timestamp', () => {
    const session = mockSession({ status: 'running', findings: [], capturedSteps: [{ url: '/p' }], activities: [{ id: 'a1' }] });
    const decision = makeDecision(session, mockEvidence({ missionResult: null }), mockMission());

    assert.ok(decision.timestamp);
    // Should be valid ISO date
    assert.ok(!isNaN(Date.parse(decision.timestamp)));
  });

  it('every decision has policy version', () => {
    const session = mockSession({ status: 'running', findings: [], capturedSteps: [{ url: '/p' }], activities: [{ id: 'a1' }] });
    const decision = makeDecision(session, mockEvidence({ missionResult: null }), mockMission());

    assert.equal(decision.policyVersion, POLICY_VERSION);
  });

  it('every decision has confidence basis in factors', () => {
    const session = mockSession({ status: 'running', findings: [], capturedSteps: [{ url: '/p' }], activities: [{ id: 'a1' }] });
    const decision = makeDecision(session, mockEvidence({ missionResult: null }), mockMission());

    assert.ok(decision.factors.confidenceBasis);
    assert.ok(Array.isArray(decision.factors.confidenceBasis));
  });

  it('decision history can reconstruct decision path', () => {
    const session = mockSession({ status: 'running', capturedSteps: [{ url: '/p' }], activities: [{ id: 'a1' }] });
    const mission = mockMission();

    // Decision 1: continue (insufficient evidence)
    makeDecision(session, mockEvidence({ missionResult: null }), mission);

    // Decision 2: escalate (critical found)
    session.status = 'done';
    session.findings = [mockFinding('critical')];
    const ev2 = mockEvidence({ missionResult: { quality: { score: 30, verdict: 'fail', releaseReady: false, confidence: 0.5, risk: 'high', criticalIssues: [{ title: 'test' }], recommendations: [], breakdown: { critical: 1 } } } });
    makeDecision(session, ev2, mission);

    // History should have 2 decisions
    assert.equal(session.decisionHistory.length, 2);
    assert.notEqual(session.decisionHistory[0].decision, session.decisionHistory[1].decision);
  });
});

/* ── 13. Factors Separation ─────────────────────────────────────── */

describe('Evidence/Decision Separation', () => {
  it('decision never modifies session findings', () => {
    const originalFindings = [mockFinding('medium', { title: 'original', confidence: 0.5 })];
    const session = mockSession({
      status: 'done',
      findings: originalFindings,
      capturedSteps: Array.from({ length: 20 }, (_, i) => ({ url: `/p${i}` })),
      activities: Array.from({ length: 20 }, (_, i) => ({ id: `a${i}` }))
    });

    makeDecision(session, mockEvidence({
      missionResult: { quality: { score: 70, verdict: 'pass_with_issues', releaseReady: true, confidence: 0.7, risk: 'low', criticalIssues: [], recommendations: [], breakdown: { medium: 1 } } }
    }), mockMission());

    // Findings should be unchanged
    assert.equal(session.findings.length, 1);
    assert.equal(session.findings[0].title, 'original');
    assert.equal(session.findings[0].confidence, 0.5);
  });

  it('decision never modifies session qualityScore', () => {
    const session = mockSession({
      status: 'done',
      findings: [],
      capturedSteps: Array.from({ length: 20 }, (_, i) => ({ url: `/p${i}` })),
      activities: Array.from({ length: 20 }, (_, i) => ({ id: `a${i}` }))
    });

    const evidence = mockEvidence({
      missionResult: { quality: { score: 50, verdict: 'fail', releaseReady: false, confidence: 0.5, risk: 'medium', criticalIssues: [], recommendations: [], breakdown: {} } }
    });

    makeDecision(session, evidence, mockMission());

    // The evidence object should not have been modified
    assert.equal(evidence.missionResult.quality.score, 50);
  });
});
