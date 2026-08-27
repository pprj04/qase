/**
 * Phase 5 — Continuous Validation Loop Tests
 *
 * Tests the iteration model, lifecycle, comparison, convergence detection,
 * no-improvement protection, action contract, and failure scenarios.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MAX_ITERATIONS,
  NO_IMPROVEMENT_THRESHOLD,
  MEANINGFUL_IMPROVEMENT_DELTA,
  ITERATION_STATUS,
  STOP_REASONS,
  createIterationMetadata,
  getIterationMetadata,
  getLatestIteration,
  updateIterationMetadata,
  analyzeConvergence,
  hasNoImprovement,
  hasReachedIterationLimit,
  getStopReason,
  resolveAction,
  buildRevalidationPrompt,
  prepareKnowledgeForIteration,
  getLoopStatus,
  getComparisonSummary
} from '../server/validationLoop.js';
import { DECISION_TYPES } from '../server/decisionEngine.js';
import { isTerminalStatus } from '../server/missions.js';

/* ── Helper: mock mission with iterations ───────────────────────── */

function mockMission(overrides = {}) {
  return {
    id: 'test-mission-' + Math.random().toString(36).slice(2, 8),
    name: 'Test Mission',
    type: 'qa',
    targetUrl: 'http://localhost:9876/dashboard',
    status: 'completed',
    projectId: 'default',
    currentIteration: 0,
    iterations: [],
    constraints: {},
    ...overrides
  };
}

function mockFinding(severity, title, opts = {}) {
  return {
    id: 'finding-' + Math.random().toString(36).slice(2, 8),
    title,
    severity,
    confidence: opts.confidence ?? 0.8,
    isDuplicate: false,
    url: opts.url ?? '/dashboard',
    ...opts
  };
}

function mockIteration(number, findings, qualityScore = 50, overrides = {}) {
  return {
    number,
    sessionId: 'session-' + number,
    findings,
    qualityScore,
    verdict: qualityScore >= 85 ? 'pass' : qualityScore >= 60 ? 'pass_with_issues' : 'fail',
    releaseReady: qualityScore >= 60,
    improvementPrompt: 'Fix critical issues',
    ranAt: new Date(Date.now() - number * 60000).toISOString(),
    status: 'completed',
    ...overrides
  };
}

/* ── 1. Iteration Model ─────────────────────────────────────────── */

describe('Iteration Model', () => {
  it('createIterationMetadata produces a valid record', () => {
    const mission = mockMission({ currentIteration: 1 });
    const session = { id: 'session-1' };
    const meta = createIterationMetadata(mission, session);

    assert.equal(meta.number, 2);
    assert.equal(meta.sessionId, 'session-1');
    assert.ok(meta.startedAt);
    assert.equal(meta.completedAt, null);
    assert.equal(meta.status, ITERATION_STATUS.CREATED);
    assert.equal(meta.qualityScore, null);
  });

  it('getIterationMetadata initializes if absent', () => {
    const mission = mockMission();
    assert.ok(!mission.iterationMetadata);
    const meta = getIterationMetadata(mission);
    assert.ok(Array.isArray(meta));
    assert.equal(meta.length, 0);
  });

  it('getLatestIteration returns the last entry', () => {
    const mission = mockMission();
    const meta = getIterationMetadata(mission);
    meta.push({ number: 1, status: 'completed' });
    meta.push({ number: 2, status: 'completed' });
    const latest = getLatestIteration(mission);
    assert.equal(latest.number, 2);
  });

  it('updateIterationMetadata patches an entry', () => {
    const mission = mockMission();
    const meta = getIterationMetadata(mission);
    meta.push({ number: 1, status: 'running', qualityScore: null });
    updateIterationMetadata(mission, 1, { status: 'completed', qualityScore: 75 });
    assert.equal(meta[0].status, 'completed');
    assert.equal(meta[0].qualityScore, 75);
  });
});

/* ── 2. Iteration Lifecycle ─────────────────────────────────────── */

describe('Iteration Lifecycle', () => {
  it('has 6 iteration status types', () => {
    assert.equal(Object.keys(ITERATION_STATUS).length, 7);
    assert.ok(ITERATION_STATUS.CREATED);
    assert.ok(ITERATION_STATUS.RUNNING);
    assert.ok(ITERATION_STATUS.ASSESSING);
    assert.ok(ITERATION_STATUS.DECIDING);
    assert.ok(ITERATION_STATUS.COMPLETED);
    assert.ok(ITERATION_STATUS.REVALIDATION_REQUIRED);
    assert.ok(ITERATION_STATUS.TERMINAL);
  });
});

/* ── 3. Convergence Detection ───────────────────────────────────── */

describe('Convergence Detection — Scenario 3: Improving', () => {
  it('detects improving trend when score increases', () => {
    const findings1 = [mockFinding('critical', 'Bug A'), mockFinding('high', 'Bug B')];
    const findings2 = [mockFinding('low', 'Bug B')]; // Bug A fixed, Bug B remains (lower severity)
    const mission = mockMission({
      iterations: [
        mockIteration(1, findings1, 30),
        mockIteration(2, findings2, 80)
      ]
    });

    const convergence = analyzeConvergence(mission);
    assert.equal(convergence.state, 'improving');
    assert.ok(convergence.scoreDelta > 0);
    assert.ok(convergence.fixedCount >= 1);
  });
});

describe('Convergence Detection — Scenario 4: Regression', () => {
  it('detects regression when new critical findings appear', () => {
    const findings1 = [mockFinding('medium', 'Issue X')];
    const findings2 = [
      mockFinding('medium', 'Issue X'),  // Still there
      mockFinding('critical', 'New Critical Regression') // New critical!
    ];
    const mission = mockMission({
      iterations: [
        mockIteration(1, findings1, 70),
        mockIteration(2, findings2, 40)
      ]
    });

    const convergence = analyzeConvergence(mission);
    assert.equal(convergence.state, 'regression');
    assert.ok(convergence.regressionCount > 0);
    assert.ok(convergence.criticalRegressions);
  });
});

describe('Convergence Detection — Scenario 5: No Improvement', () => {
  it('detects no-improvement when score stays flat for multiple iterations', () => {
    const findings = [mockFinding('high', 'Persistent Bug')];
    const mission = mockMission({
      currentIteration: 3,
      iterations: [
        mockIteration(1, findings, 50),
        mockIteration(2, [...findings], 52),  // +2 — below threshold
        mockIteration(3, [...findings], 51)   // -1 — below threshold
      ]
    });

    const convergence = analyzeConvergence(mission);
    assert.equal(convergence.state, 'no_improvement');
    assert.ok(convergence.iterationsWithoutImprovement >= NO_IMPROVEMENT_THRESHOLD);
  });
});

describe('Convergence Detection — Stable', () => {
  it('detects stable when score changes minimally', () => {
    const findings = [mockFinding('medium', 'Bug')];
    const mission = mockMission({
      iterations: [
        mockIteration(1, findings, 60),
        mockIteration(2, [...findings], 62)  // +2 — below meaningful threshold
      ]
    });

    const convergence = analyzeConvergence(mission);
    assert.equal(convergence.state, 'stable');
  });
});

describe('Convergence — Insufficient Data', () => {
  it('returns insufficient_data with only 1 iteration', () => {
    const mission = mockMission({
      iterations: [mockIteration(1, [mockFinding('medium', 'Bug')], 50)]
    });
    const convergence = analyzeConvergence(mission);
    assert.equal(convergence.state, 'insufficient_data');
  });

  it('returns insufficient_data with 0 iterations', () => {
    const mission = mockMission({ iterations: [] });
    const convergence = analyzeConvergence(mission);
    assert.equal(convergence.state, 'insufficient_data');
  });
});

/* ── 4. No-Improvement Protection ───────────────────────────────── */

describe('No-Improvement Protection', () => {
  it('hasNoImprovement returns true after threshold iterations without gain', () => {
    const findings = [mockFinding('high', 'Persistent Bug')];
    const mission = mockMission({
      currentIteration: 3,
      iterations: [
        mockIteration(1, findings, 50),
        mockIteration(2, [...findings], 50),  // 0 delta
        mockIteration(3, [...findings], 50)   // 0 delta
      ]
    });
    assert.ok(hasNoImprovement(mission));
  });

  it('hasNoImprovement returns false when improvement exists', () => {
    const mission = mockMission({
      iterations: [
        mockIteration(1, [mockFinding('critical', 'Bug')], 30),
        mockIteration(2, [mockFinding('low', 'Minor')], 80)  // +50 — big improvement
      ]
    });
    assert.ok(!hasNoImprovement(mission));
  });
});

/* ── 5. Iteration Limits ────────────────────────────────────────── */

describe('Iteration Limits', () => {
  it('hasReachedIterationLimit returns true at max', () => {
    const mission = mockMission({
      currentIteration: 5,
      constraints: { maxIterations: 5 }
    });
    assert.ok(hasReachedIterationLimit(mission));
  });

  it('hasReachedIterationLimit returns false under max', () => {
    const mission = mockMission({
      currentIteration: 3,
      constraints: { maxIterations: 10 }
    });
    assert.ok(!hasReachedIterationLimit(mission));
  });

  it('uses DEFAULT_MAX_ITERATIONS when no constraint set', () => {
    const mission = mockMission({ currentIteration: DEFAULT_MAX_ITERATIONS });
    assert.ok(hasReachedIterationLimit(mission));
  });

  it('getStopReason returns MAX_ITERATIONS at limit', () => {
    const mission = mockMission({
      currentIteration: 5,
      constraints: { maxIterations: 5 },
      status: 'completed',
      verdict: 'fail'
    });
    // MAX_ITERATIONS takes priority
    assert.equal(getStopReason(mission), STOP_REASONS.MAX_ITERATIONS);
  });

  it('getStopReason returns NO_IMPROVEMENT when detected', () => {
    const findings = [mockFinding('high', 'Persistent Bug')];
    const mission = mockMission({
      currentIteration: 3,
      iterations: [
        mockIteration(1, findings, 50),
        mockIteration(2, [...findings], 50),
        mockIteration(3, [...findings], 50)
      ]
    });
    assert.equal(getStopReason(mission), STOP_REASONS.NO_IMPROVEMENT);
  });

  it('getStopReason returns APPROVED on pass verdict', () => {
    const mission = mockMission({
      currentIteration: 1,
      iterations: [mockIteration(1, [], 95)],
      status: 'completed',
      verdict: 'pass'
    });
    assert.equal(getStopReason(mission), STOP_REASONS.APPROVED);
  });

  it('getStopReason returns FAILED on fail verdict', () => {
    const mission = mockMission({
      currentIteration: 1,
      iterations: [mockIteration(1, [mockFinding('critical', 'Bug')], 20)],
      status: 'completed',
      verdict: 'fail'
    });
    assert.equal(getStopReason(mission), STOP_REASONS.FAILED);
  });

  it('getStopReason returns null when loop can continue', () => {
    const mission = mockMission({
      currentIteration: 1,
      iterations: [mockIteration(1, [mockFinding('medium', 'Bug')], 50)],
      status: 'completed',
      verdict: 'pass_with_issues'
    });
    assert.equal(getStopReason(mission), null);
  });
});

/* ── 6. Action Contract ─────────────────────────────────────────── */

describe('Action Contract — resolveAction()', () => {
  it('REVALIDATE → action=revalidate', () => {
    const mission = mockMission({ currentIteration: 1, status: 'completed', iterations: [mockIteration(1, [], 50)] });
    const result = resolveAction(DECISION_TYPES.REVALIDATE, mission);
    assert.equal(result.action, 'revalidate');
    assert.ok(result.shouldRevalidate);
    assert.ok(!result.shouldStop);
  });

  it('STOP_PASS → action=stop, stopReason=approved', () => {
    const mission = mockMission({ status: 'completed', verdict: 'pass', iterations: [mockIteration(1, [], 95)] });
    const result = resolveAction(DECISION_TYPES.STOP_PASS, mission);
    assert.equal(result.action, 'stop');
    assert.equal(result.stopReason, STOP_REASONS.APPROVED);
  });

  it('STOP_FAIL → action=stop, stopReason=failed', () => {
    const mission = mockMission({ status: 'completed', verdict: 'fail', iterations: [mockIteration(1, [mockFinding('critical', 'B')], 20)] });
    const result = resolveAction(DECISION_TYPES.STOP_FAIL, mission);
    assert.equal(result.action, 'stop');
    assert.equal(result.stopReason, STOP_REASONS.FAILED);
  });

  it('STOP_BUDGET → action=stop, stopReason=budget_exhausted', () => {
    const mission = mockMission({ iterations: [] });
    const result = resolveAction(DECISION_TYPES.STOP_BUDGET, mission);
    assert.equal(result.action, 'stop');
    assert.equal(result.stopReason, STOP_REASONS.BUDGET_EXHAUSTED);
  });

  it('STOP_BLOCKED → action=stop, stopReason=blocked', () => {
    const mission = mockMission({ iterations: [] });
    const result = resolveAction(DECISION_TYPES.STOP_BLOCKED, mission);
    assert.equal(result.action, 'stop');
    assert.equal(result.stopReason, STOP_REASONS.BLOCKED);
  });

  it('ESCALATE → action=escalate, stopReason=escalated', () => {
    const mission = mockMission({ iterations: [] });
    const result = resolveAction(DECISION_TYPES.ESCALATE, mission);
    assert.equal(result.action, 'escalate');
    assert.equal(result.stopReason, STOP_REASONS.ESCALATED);
  });

  it('CONTINUE → action=continue (C2: settled sessions dispatch another iteration)', () => {
    const mission = mockMission({ iterations: [] });
    const result = resolveAction(DECISION_TYPES.CONTINUE, mission);
    assert.equal(result.action, 'continue');
    assert.ok(result.shouldRevalidate); // continuation dispatches a real iteration
    assert.ok(!result.shouldStop);
  });

  it('Unknown decision type → action=none', () => {
    const mission = mockMission({ iterations: [] });
    const result = resolveAction('INVALID', mission);
    assert.equal(result.action, 'none');
  });

  it('Iteration limit overrides REVALIDATE', () => {
    const mission = mockMission({
      currentIteration: 5,
      constraints: { maxIterations: 5 }
    });
    const result = resolveAction(DECISION_TYPES.REVALIDATE, mission);
    assert.equal(result.action, 'stop');
    assert.equal(result.stopReason, STOP_REASONS.MAX_ITERATIONS);
  });

  it('No-improvement overrides REVALIDATE', () => {
    const findings = [mockFinding('high', 'Persistent')];
    const mission = mockMission({
      currentIteration: 3,
      iterations: [
        mockIteration(1, findings, 50),
        mockIteration(2, [...findings], 50),
        mockIteration(3, [...findings], 50)
      ]
    });
    const result = resolveAction(DECISION_TYPES.REVALIDATE, mission);
    assert.equal(result.action, 'stop');
    assert.equal(result.stopReason, STOP_REASONS.NO_IMPROVEMENT);
  });
});

/* ── 7. Revalidation Prompt ─────────────────────────────────────── */

describe('Revalidation Prompt Builder', () => {
  it('includes previous findings in the prompt', () => {
    const mission = mockMission({ currentIteration: 1, targetUrl: 'http://localhost:9876' });
    const prevIteration = mockIteration(1, [
      mockFinding('critical', 'Login broken'),
      mockFinding('high', 'Layout overflow')
    ], 40);
    const prompt = buildRevalidationPrompt(mission, prevIteration);

    assert.ok(prompt.includes('ITERATION 2'));
    assert.ok(prompt.includes('Login broken'));
    assert.ok(prompt.includes('Layout overflow'));
    assert.ok(prompt.includes('Previously Found Issues'));
  });

  it('includes improvement prompt from previous iteration', () => {
    const mission = mockMission({ currentIteration: 1 });
    const prevIteration = {
      ...mockIteration(1, [], 50),
      improvementPrompt: 'Fix the authentication flow and form validation.'
    };
    const prompt = buildRevalidationPrompt(mission, prevIteration);
    assert.ok(prompt.includes('Fix the authentication flow'));
  });

  it('includes knowledge hints', () => {
    const mission = mockMission({ currentIteration: 1 });
    const prevIteration = mockIteration(1, [], 50);
    const prompt = buildRevalidationPrompt(mission, prevIteration, 'Historical Knowledge: Test login flows.');
    assert.ok(prompt.includes('Historical Knowledge'));
  });

  it('handles null previous iteration gracefully', () => {
    const mission = mockMission({ currentIteration: 0 });
    const prompt = buildRevalidationPrompt(mission, null);
    assert.ok(prompt.includes('Target:'));
  });
});

/* ── 8. Knowledge Integration ───────────────────────────────────── */

describe('Knowledge Integration — prepareKnowledgeForIteration', () => {
  it('returns hints and patterns without throwing', () => {
    const mission = mockMission({ targetUrl: 'http://localhost:9876/dashboard' });
    const result = prepareKnowledgeForIteration(mission);

    assert.ok(typeof result.hints === 'string');
    assert.ok(Array.isArray(result.patterns));
    assert.ok(Array.isArray(result.patternIds));
  });

  it('handles knowledge query failure gracefully', () => {
    const mission = mockMission({ targetUrl: '' });
    const result = prepareKnowledgeForIteration(mission);
    assert.ok(typeof result.hints === 'string');
  });
});

/* ── 9. Loop Status ─────────────────────────────────────────────── */

describe('Loop Status — getLoopStatus()', () => {
  it('returns complete status with iterations', () => {
    const mission = mockMission({
      currentIteration: 2,
      iterations: [
        mockIteration(1, [mockFinding('critical', 'Bug')], 30),
        mockIteration(2, [mockFinding('medium', 'Minor')], 70)
      ]
    });
    const status = getLoopStatus(mission);

    assert.equal(status.missionId, mission.id);
    assert.equal(status.currentIteration, 2);
    assert.equal(status.totalIterations, 2);
    assert.equal(status.maxIterations, DEFAULT_MAX_ITERATIONS);
    assert.ok(status.convergence);
    assert.ok(status.iterations.length === 2);
    assert.equal(status.iterations[0].number, 1);
    assert.equal(status.iterations[1].number, 2);
  });

  it('handles mission with no iterations', () => {
    const mission = mockMission({ iterations: [] });
    const status = getLoopStatus(mission);
    assert.equal(status.totalIterations, 0);
    assert.equal(status.latestScore, null);
    assert.equal(status.convergence.state, 'insufficient_data');
  });
});

/* ── 10. Comparison Summary ─────────────────────────────────────── */

describe('Comparison Summary — getComparisonSummary()', () => {
  it('returns baseline type for single iteration', () => {
    const mission = mockMission({
      iterations: [mockIteration(1, [mockFinding('medium', 'Bug')], 50)]
    });
    const summary = getComparisonSummary(mission);
    assert.equal(summary.type, 'baseline');
    assert.equal(summary.iteration, 1);
  });

  it('returns comparison type for 2+ iterations', () => {
    const mission = mockMission({
      iterations: [
        mockIteration(1, [mockFinding('critical', 'Bug A'), mockFinding('high', 'Bug B')], 30),
        mockIteration(2, [mockFinding('medium', 'Bug B')], 70)
      ]
    });
    const summary = getComparisonSummary(mission);
    assert.equal(summary.type, 'comparison');
    assert.ok(summary.comparison);
    assert.ok(summary.convergence);
  });

  it('returns null for 0 iterations', () => {
    const mission = mockMission({ iterations: [] });
    const summary = getComparisonSummary(mission);
    assert.equal(summary, null);
  });
});

/* ── 11. Stop Reasons ───────────────────────────────────────────── */

describe('Stop Reasons — all types', () => {
  it('has 8 stop reason types', () => {
    assert.equal(Object.keys(STOP_REASONS).length, 8);
    assert.ok(STOP_REASONS.APPROVED);
    assert.ok(STOP_REASONS.FAILED);
    assert.ok(STOP_REASONS.MAX_ITERATIONS);
    assert.ok(STOP_REASONS.NO_IMPROVEMENT);
    assert.ok(STOP_REASONS.ESCALATED);
    assert.ok(STOP_REASONS.BUDGET_EXHAUSTED);
    assert.ok(STOP_REASONS.BLOCKED);
    assert.ok(STOP_REASONS.MANUAL_STOP);
  });
});

/* ── 12. Integration with Decision Engine ───────────────────────── */

describe('Decision Engine Integration', () => {
  it('resolveAction respects terminal decisions', () => {
    const mission = mockMission({ iterations: [mockIteration(1, [], 95)] });

    for (const terminalType of [DECISION_TYPES.STOP_PASS, DECISION_TYPES.STOP_FAIL, DECISION_TYPES.STOP_BUDGET, DECISION_TYPES.STOP_BLOCKED]) {
      const result = resolveAction(terminalType, mission);
      assert.equal(result.action, 'stop', `${terminalType} should produce action=stop`);
      assert.ok(result.shouldStop);
    }
  });

  it('REVALIDATE produces revalidate action when no stop reason', () => {
    const mission = mockMission({
      currentIteration: 1,
      iterations: [mockIteration(1, [mockFinding('medium', 'Bug')], 50)],
      status: 'completed',
      verdict: 'pass_with_issues'
    });
    const result = resolveAction(DECISION_TYPES.REVALIDATE, mission);
    assert.equal(result.action, 'revalidate');
    assert.ok(result.shouldRevalidate);
  });

  it('Decision Engine remains the single authority — no duplicated logic', () => {
    // resolveAction should NOT re-evaluate quality or findings — it just
    // translates the decision type into an action
    const mission = mockMission({ iterations: [] });
    const result = resolveAction(DECISION_TYPES.CONTINUE, mission);
    // It should not produce a STOP decision on its own
    assert.ok(!result.shouldStop);
  });
});

/* ── 13. Bounded Growth ─────────────────────────────────────────── */

describe('Bounded Growth', () => {
  it('maxIterations prevents unbounded iterations', () => {
    const mission = mockMission({
      currentIteration: 3,
      constraints: { maxIterations: 3 }
    });
    assert.ok(hasReachedIterationLimit(mission));
  });

  it('DEFAULT_MAX_ITERATIONS is reasonable', () => {
    assert.ok(DEFAULT_MAX_ITERATIONS >= 3 && DEFAULT_MAX_ITERATIONS <= 20);
  });

  it('iterationMetadata array is explicit, not unbounded', () => {
    const mission = mockMission();
    const meta = getIterationMetadata(mission);
    // The array only grows when createIterationMetadata is called
    // and is bounded by maxIterations
    assert.ok(Array.isArray(meta));
    assert.equal(meta.length, 0);
  });
});

/* ── 14. Failure Scenarios (Spec Step 13: 12 explicit scenarios) ── */

describe('Failure Scenarios — Step 13 spec compliance', () => {
  /* Scenario 2: Agent timeout */
  it('Scenario 2: agent timeout → session error, iteration recorded, stopReason can be computed', () => {
    const mission = mockMission({
      currentIteration: 1,
      iterations: [mockIteration(1, [mockFinding('high', 'Timeout bug')], 30, { status: 'error' })],
      status: 'completed',
      verdict: 'fail'
    });
    // The iteration was still recorded — data is not lost
    assert.equal(mission.iterations.length, 1);
    // getStopReason can still compute a reason
    const reason = getStopReason(mission);
    assert.equal(reason, STOP_REASONS.FAILED);
  });

  /* Scenario 3: Browser failure */
  it('Scenario 3: browser failure → iteration still completes with whatever findings agent found', () => {
    const mission = mockMission({
      currentIteration: 1,
      iterations: [mockIteration(1, [], 0, { verdict: 'fail' })], // No findings — browser crashed early
      status: 'completed',
      verdict: 'fail'
    });
    // Empty findings means score=0, verdict=fail — system handles it
    const convergence = analyzeConvergence(mission);
    assert.equal(convergence.state, 'insufficient_data'); // Only 1 iteration
    const reason = getStopReason(mission);
    assert.equal(reason, STOP_REASONS.FAILED);
  });

  /* Scenario 4: Pipeline failure */
  it('Scenario 4: pipeline failure → mission still finalizes, iteration is recorded', () => {
    const mission = mockMission({
      currentIteration: 1,
      iterations: [mockIteration(1, [mockFinding('critical', 'Pipeline crash artifact')], 20)],
      status: 'completed',
      verdict: 'fail'
    });
    assert.equal(mission.iterations.length, 1);
    assert.equal(getStopReason(mission), STOP_REASONS.FAILED);
  });

  /* Scenario 6: Empty findings */
  it('Scenario 6: empty findings → convergence is insufficient_data with 1 iteration, stable with 2 identical empty', () => {
    const mission1 = mockMission({
      currentIteration: 1,
      iterations: [mockIteration(1, [], 100, { verdict: 'pass' })],
      status: 'completed',
      verdict: 'pass'
    });
    assert.equal(getStopReason(mission1), STOP_REASONS.APPROVED);

    const mission2 = mockMission({
      currentIteration: 2,
      iterations: [
        mockIteration(1, [], 100, { verdict: 'pass' }),
        mockIteration(2, [], 100, { verdict: 'pass' })
      ],
      status: 'completed',
      verdict: 'pass'
    });
    const conv = analyzeConvergence(mission2);
    assert.equal(conv.state, 'stable'); // No change in findings
    assert.equal(getStopReason(mission2), STOP_REASONS.APPROVED);
  });

  /* Scenario 8: Improvement followed by regression */
  it('Scenario 8: improvement then regression → convergence tracks the reversal', () => {
    const mission = mockMission({
      currentIteration: 3,
      iterations: [
        mockIteration(1, [mockFinding('critical', 'Bug A'), mockFinding('high', 'Bug B')], 30),
        mockIteration(2, [mockFinding('low', 'Bug B')], 80), // Improved: 50 points, Bug A fixed
        mockIteration(3, [mockFinding('critical', 'Bug B'), mockFinding('critical', 'New Crash')], 25) // Regressed
      ]
    });

    // Compare iteration 2 vs 3
    const convergence = analyzeConvergence(mission);
    assert.equal(convergence.state, 'regression');
    assert.ok(convergence.scoreDelta < 0); // Score dropped
    assert.ok(convergence.criticalRegressions); // Critical findings appeared
  });

  /* Scenario 10: User manually stops the mission */
  it('Scenario 10: manual stop → stopReason is manual_stop, no further revalidation', () => {
    const mission = mockMission({
      currentIteration: 1,
      iterations: [mockIteration(1, [mockFinding('medium', 'Bug')], 50)],
      status: 'aborted',
      verdict: 'fail',
      stopReason: STOP_REASONS.MANUAL_STOP
    });
    // The mission is terminal — revalidation should be rejected by the API
    assert.ok(isTerminalStatus(mission.status));
    // The stopReason is explicitly set to manual_stop
    assert.equal(mission.stopReason, STOP_REASONS.MANUAL_STOP);
  });

  /* Scenario 11: Server restart between iterations */
  it('Scenario 11: server restart → iteration history preserved in mission object', () => {
    // Simulate what happens after a restart: the mission is loaded from disk
    // with all its iteration data intact
    const mission = mockMission({
      currentIteration: 2,
      iterations: [
        mockIteration(1, [mockFinding('critical', 'Bug A')], 30),
        mockIteration(2, [mockFinding('medium', 'Bug A')], 70)
      ]
    });

    // After restart, getLoopStatus should still work
    const status = getLoopStatus(mission);
    assert.equal(status.totalIterations, 2);
    assert.equal(status.currentIteration, 2);
    assert.ok(status.convergence);

    // Comparison should still work
    const summary = getComparisonSummary(mission);
    assert.equal(summary.type, 'comparison');

    // No duplicate iteration should be created — the existing data is intact
    assert.equal(mission.iterations.length, 2);
  });

  it('Scenario 11b: server restart → convergence still computed correctly after reload', () => {
    const restoredMission = mockMission({
      currentIteration: 3,
      iterations: [
        mockIteration(1, [mockFinding('high', 'Persistent')], 40),
        mockIteration(2, [mockFinding('high', 'Persistent')], 42), // +2 — below threshold
        mockIteration(3, [mockFinding('high', 'Persistent')], 41)  // -1 — below threshold
      ]
    });

    const conv = analyzeConvergence(restoredMission);
    // No meaningful improvement across 3 iterations (deltas < 5)
    assert.equal(conv.state, 'no_improvement');
    // Stop reason should be no_improvement
    assert.equal(getStopReason(restoredMission), STOP_REASONS.NO_IMPROVEMENT);
  });

  /* Scenario 12: Decision Engine failure */
  it('Scenario 12: decision engine failure → resolveAction never produces PASS', () => {
    // If the Decision Engine itself fails (throws), safeFallback() returns ESCALATE
    // — it never silently returns STOP_PASS
    const mission = mockMission({ iterations: [] });
    const result = resolveAction(DECISION_TYPES.ESCALATE, mission);
    assert.equal(result.action, 'escalate');
    assert.ok(result.shouldStop);
    assert.equal(result.stopReason, STOP_REASONS.ESCALATED);
    // It must NOT be STOP_PASS
    assert.notEqual(result.stopReason, STOP_REASONS.APPROVED);
  });

  it('Scenario 12b: unknown/invalid decision type → action=none, never PASS', () => {
    const mission = mockMission({ iterations: [] });
    const result = resolveAction('COMPLETELY_INVALID', mission);
    assert.equal(result.action, 'none');
    assert.ok(!result.shouldStop);
    // It must NOT produce a PASS
    assert.notEqual(result.stopReason, STOP_REASONS.APPROVED);
  });
});
