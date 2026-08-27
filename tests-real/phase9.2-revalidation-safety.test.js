/**
 * Phase 9.2 — Revalidation Safety Tests
 *
 * Validates ALL safety guards on the validation loop:
 *   1. REVALIDATE triggers next iteration (happy path)
 *   2. REVALIDATE again (multi-iteration chain)
 *   3. NO_IMPROVEMENT stops the loop
 *   4. MAX_ITERATIONS stops the loop
 *   5. BUDGET_EXHAUSTED stops the loop
 *   6. BLOCKED state stops the loop
 *   7. ESCALATE stops the loop
 *   8. No infinite loop (iteration cap prevents runaway)
 *   9. Idempotency (duplicate revalidation calls don't spawn duplicate sessions)
 *  10. resolveAction mapping for all decision types
 *  11. Stop conditions correctly detected
 *  12. Convergence tracking across iterations
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
  getLoopStatus,
  getComparisonSummary,
  prepareKnowledgeForIteration
} from '../server/validationLoop.js';

import { DECISION_TYPES, TERMINAL_DECISIONS } from '../server/decisionEngine.js';

/* ── Helpers ──────────────────────────────────────────────────────── */

function makeMission(overrides = {}) {
  return {
    id: 'mission-test-001',
    name: 'Test Mission',
    targetUrl: 'http://localhost:9901',
    status: 'completed',
    currentIteration: 1,
    iterations: [],
    iterationMetadata: [],
    constraints: { maxIterations: 3 },
    ...overrides
  };
}

function makeIteration(number, qualityScore, findings = [], verdict = 'pass_with_issues') {
  return {
    number,
    qualityScore,
    verdict,
    findings,
    sessionId: `session-${number}`,
    ranAt: Date.now() - (10 - number) * 60000
  };
}

function makeFinding(id, title, severity = 'medium') {
  return { id, title, severity };
}

/* ── Test Suites ──────────────────────────────────────────────────── */

describe('Phase 9.2 — Revalidation Safety: REVALIDATE Decision', () => {
  it('R1: REVALIDATE decision triggers shouldRevalidate=true', () => {
    const mission = makeMission({ iterations: [makeIteration(1, 50, [makeFinding('f1', 'Bug')])] });
    const result = resolveAction(DECISION_TYPES.REVALIDATE, mission);
    assert.equal(result.shouldRevalidate, true);
    assert.equal(result.shouldStop, false);
    assert.equal(result.action, 'revalidate');
  });

  it('R2: REVALIDATE can chain multiple iterations', () => {
    const mission = makeMission({
      currentIteration: 2,
      iterations: [
        makeIteration(1, 40, [makeFinding('f1', 'Bug A')]),
        makeIteration(2, 50, [makeFinding('f1', 'Bug A')])
      ],
      constraints: { maxIterations: 5 }
    });
    const result = resolveAction(DECISION_TYPES.REVALIDATE, mission);
    assert.equal(result.shouldRevalidate, true);
    assert.equal(hasReachedIterationLimit(mission), false);
  });

  it('R3: REVALIDATE produces a revalidation prompt with previous findings', () => {
    const mission = makeMission({ currentIteration: 1 });
    const prevIter = makeIteration(1, 40, [
      makeFinding('f1', 'Login button broken', 'high'),
      makeFinding('f2', 'Slow API response', 'medium')
    ]);
    const prompt = buildRevalidationPrompt(mission, prevIter, '');
    assert.ok(prompt.includes('ITERATION 2'));
    assert.ok(prompt.includes('Login button broken'));
    assert.ok(prompt.includes('Slow API response'));
    assert.ok(prompt.includes('Previously Found Issues'));
  });

  it('R4: Revalidation prompt includes knowledge hints', () => {
    const mission = makeMission({ currentIteration: 1 });
    const prevIter = makeIteration(1, 40, []);
    const prompt = buildRevalidationPrompt(mission, prevIter, 'HINT: Check authentication flows');
    assert.ok(prompt.includes('Check authentication flows'));
  });
});

describe('Phase 9.2 — Revalidation Safety: MAX_ITERATIONS Guard', () => {
  it('M1: Mission at max iterations → hasReachedIterationLimit returns true', () => {
    const mission = makeMission({
      currentIteration: 3,
      constraints: { maxIterations: 3 }
    });
    assert.equal(hasReachedIterationLimit(mission), true);
  });

  it('M2: Mission below max iterations → limit not reached', () => {
    const mission = makeMission({
      currentIteration: 2,
      constraints: { maxIterations: 3 }
    });
    assert.equal(hasReachedIterationLimit(mission), false);
  });

  it('M3: REVALIDATE with max iterations reached → resolveAction stops', () => {
    const mission = makeMission({
      currentIteration: 3,
      constraints: { maxIterations: 3 }
    });
    const result = resolveAction(DECISION_TYPES.REVALIDATE, mission);
    assert.equal(result.shouldRevalidate, false);
    assert.equal(result.shouldStop, true);
    assert.equal(result.stopReason, STOP_REASONS.MAX_ITERATIONS);
  });

  it('M4: getStopReason returns MAX_ITERATIONS when limit reached', () => {
    const mission = makeMission({
      currentIteration: 3,
      constraints: { maxIterations: 3 }
    });
    assert.equal(getStopReason(mission), STOP_REASONS.MAX_ITERATIONS);
  });

  it('M5: No maxIterations in constraints → uses DEFAULT_MAX_ITERATIONS (10)', () => {
    const mission = makeMission({
      currentIteration: 5,
      constraints: {}
    });
    assert.equal(hasReachedIterationLimit(mission), false);
    const mission2 = makeMission({
      currentIteration: 10,
      constraints: {}
    });
    assert.equal(hasReachedIterationLimit(mission2), true);
  });
});

describe('Phase 9.2 — Revalidation Safety: NO_IMPROVEMENT Guard', () => {
  it('N1: Two iterations with < delta improvement → no_improvement detected', () => {
    const mission = makeMission({
      currentIteration: 3,
      iterations: [
        makeIteration(1, 50, [makeFinding('f1', 'Bug')]),
        makeIteration(2, 52, [makeFinding('f1', 'Bug')]),  // +2 < MEANINGFUL_IMPROVEMENT_DELTA
        makeIteration(3, 53, [makeFinding('f1', 'Bug')])   // +1 < MEANINGFUL_IMPROVEMENT_DELTA
      ]
    });
    const conv = analyzeConvergence(mission);
    assert.equal(conv.iterationsWithoutImprovement >= NO_IMPROVEMENT_THRESHOLD, true);
    assert.equal(hasNoImprovement(mission), true);
  });

  it('N2: Recent improvement → NO_IMPROVEMENT not triggered', () => {
    const mission = makeMission({
      currentIteration: 3,
      iterations: [
        makeIteration(1, 40, [makeFinding('f1', 'Bug')]),
        makeIteration(2, 50, [makeFinding('f1', 'Bug')]),  // +10 >= delta
        makeIteration(3, 55, [makeFinding('f1', 'Bug')])   // +5 >= delta
      ]
    });
    const conv = analyzeConvergence(mission);
    assert.ok(conv.iterationsWithoutImprovement < NO_IMPROVEMENT_THRESHOLD,
      `expected < ${NO_IMPROVEMENT_THRESHOLD}, got ${conv.iterationsWithoutImprovement}`);
    assert.equal(hasNoImprovement(mission), false);
  });

  it('N3: REVALIDATE with no_improvement → resolveAction stops', () => {
    const mission = makeMission({
      currentIteration: 3,
      iterations: [
        makeIteration(1, 50, [makeFinding('f1', 'Bug')]),
        makeIteration(2, 51, [makeFinding('f1', 'Bug')]),
        makeIteration(3, 52, [makeFinding('f1', 'Bug')])
      ],
      constraints: { maxIterations: 10 }
    });
    const result = resolveAction(DECISION_TYPES.REVALIDATE, mission);
    assert.equal(result.shouldRevalidate, false);
    assert.equal(result.shouldStop, true);
    assert.equal(result.stopReason, STOP_REASONS.NO_IMPROVEMENT);
  });

  it('N4: getStopReason returns NO_IMPROVEMENT when convergence flatlines', () => {
    const mission = makeMission({
      currentIteration: 3,
      iterations: [
        makeIteration(1, 50, [makeFinding('f1', 'Bug')]),
        makeIteration(2, 51, [makeFinding('f1', 'Bug')]),
        makeIteration(3, 52, [makeFinding('f1', 'Bug')])
      ],
      constraints: { maxIterations: 10 }
    });
    assert.equal(getStopReason(mission), STOP_REASONS.NO_IMPROVEMENT);
  });
});

describe('Phase 9.2 — Revalidation Safety: BUDGET_EXHAUSTED Guard', () => {
  it('B1: STOP_BUDGET is a terminal decision', () => {
    assert.equal(TERMINAL_DECISIONS.has(DECISION_TYPES.STOP_BUDGET), true);
  });

  it('B2: resolveAction(STOP_BUDGET) → stop with BUDGET_EXHAUSTED', () => {
    const mission = makeMission();
    const result = resolveAction(DECISION_TYPES.STOP_BUDGET, mission);
    assert.equal(result.shouldStop, true);
    assert.equal(result.shouldRevalidate, false);
    assert.equal(result.stopReason, STOP_REASONS.BUDGET_EXHAUSTED);
  });

  it('B3: STOP_BUDGET prevents further iterations even if REVALIDATE was possible', () => {
    const mission = makeMission({
      currentIteration: 1,
      iterations: [makeIteration(1, 30, [makeFinding('f1', 'Bug')])],
      constraints: { maxIterations: 5 }
    });
    // If budget was exhausted, STOP_BUDGET is a terminal decision
    const result = resolveAction(DECISION_TYPES.STOP_BUDGET, mission);
    assert.equal(result.shouldStop, true);
    assert.equal(result.shouldRevalidate, false);
  });
});

describe('Phase 9.2 — Revalidation Safety: BLOCKED Guard', () => {
  it('BK1: STOP_BLOCKED is a terminal decision', () => {
    assert.equal(TERMINAL_DECISIONS.has(DECISION_TYPES.STOP_BLOCKED), true);
  });

  it('BK2: resolveAction(STOP_BLOCKED) → stop with BLOCKED', () => {
    const mission = makeMission();
    const result = resolveAction(DECISION_TYPES.STOP_BLOCKED, mission);
    assert.equal(result.shouldStop, true);
    assert.equal(result.shouldRevalidate, false);
    assert.equal(result.stopReason, STOP_REASONS.BLOCKED);
  });
});

describe('Phase 9.2 — Revalidation Safety: ESCALATE Guard', () => {
  it('E1: ESCALATE is handled separately from terminal decisions', () => {
    // ESCALATE is NOT in TERMINAL_DECISIONS — it has its own resolveAction branch
    assert.equal(TERMINAL_DECISIONS.has(DECISION_TYPES.ESCALATE), false);
  });

  it('E2: resolveAction(ESCALATE) → escalate, no revalidation', () => {
    const mission = makeMission();
    const result = resolveAction(DECISION_TYPES.ESCALATE, mission);
    assert.equal(result.shouldStop, true);
    assert.equal(result.shouldRevalidate, false);
    assert.equal(result.action, 'escalate');
    assert.equal(result.stopReason, STOP_REASONS.ESCALATED);
  });

  it('E3: ESCALATE takes priority over REVALIDATE intent', () => {
    const mission = makeMission({
      currentIteration: 1,
      iterations: [makeIteration(1, 40, [makeFinding('f1', 'Bug')])],
      constraints: { maxIterations: 5 }
    });
    // Even if budget allows, ESCALATE means stop
    const result = resolveAction(DECISION_TYPES.ESCALATE, mission);
    assert.equal(result.shouldRevalidate, false);
  });
});

describe('Phase 9.2 — Revalidation Safety: Terminal Decisions', () => {
  it('T1: STOP_PASS → stop, no revalidation', () => {
    const mission = makeMission();
    const result = resolveAction(DECISION_TYPES.STOP_PASS, mission);
    assert.equal(result.shouldStop, true);
    assert.equal(result.shouldRevalidate, false);
    assert.equal(result.stopReason, STOP_REASONS.APPROVED);
  });

  it('T2: STOP_FAIL → stop, no revalidation', () => {
    const mission = makeMission();
    const result = resolveAction(DECISION_TYPES.STOP_FAIL, mission);
    assert.equal(result.shouldStop, true);
    assert.equal(result.shouldRevalidate, false);
    assert.equal(result.stopReason, STOP_REASONS.FAILED);
  });

  it('T3: All terminal decisions prevent revalidation', () => {
    const mission = makeMission({ constraints: { maxIterations: 5 } });
    for (const td of TERMINAL_DECISIONS) {
      const result = resolveAction(td, mission);
      assert.equal(result.shouldRevalidate, false, `${td} should not allow revalidation`);
      assert.equal(result.shouldStop, true, `${td} should stop`);
    }
  });
});

describe('Phase 9.2 — Revalidation Safety: No Infinite Loop', () => {
  it('I1: Simulate 10 iterations all returning REVALIDATE → loop must terminate at MAX_ITERATIONS', () => {
    const maxIter = 3;
    let mission = makeMission({ currentIteration: 0, iterations: [], constraints: { maxIterations: maxIter } });
    let revalidationCount = 0;
    let loopTerminated = false;

    for (let i = 1; i <= 20; i++) {  // Try to force infinite loop
      mission.currentIteration = i;

      // Check if we've reached the limit
      if (hasReachedIterationLimit(mission)) {
        loopTerminated = true;
        break;
      }

      // Simulate REVALIDATE
      const action = resolveAction(DECISION_TYPES.REVALIDATE, mission);
      if (!action.shouldRevalidate) {
        loopTerminated = true;
        break;
      }
      revalidationCount++;
    }

    assert.equal(loopTerminated, true, 'Loop must terminate');
    assert.ok(revalidationCount <= maxIter,
      `Revalidations (${revalidationCount}) must not exceed maxIterations (${maxIter})`);
  });

  it('I2: NO_IMPROVEMENT after 2 flat iterations prevents runaway', () => {
    const mission = makeMission({
      currentIteration: 4,
      iterations: [
        makeIteration(1, 50, [makeFinding('f1', 'Bug')]),
        makeIteration(2, 51, [makeFinding('f1', 'Bug')]),
        makeIteration(3, 52, [makeFinding('f1', 'Bug')]),
        makeIteration(4, 53, [makeFinding('f1', 'Bug')])
      ],
      constraints: { maxIterations: 10 }
    });
    // Even with 10 max iterations, no-improvement stops the loop
    const action = resolveAction(DECISION_TYPES.REVALIDATE, mission);
    assert.equal(action.shouldStop, true);
    assert.equal(action.shouldRevalidate, false);
    assert.equal(action.stopReason, STOP_REASONS.NO_IMPROVEMENT);
  });
});

describe('Phase 9.2 — Revalidation Safety: Idempotency', () => {
  it('ID1: resolveAction is deterministic — same decision + same mission = same result', () => {
    const mission = makeMission({
      currentIteration: 2,
      iterations: [makeIteration(1, 40), makeIteration(2, 45)],
      constraints: { maxIterations: 5 }
    });
    const r1 = resolveAction(DECISION_TYPES.REVALIDATE, mission);
    const r2 = resolveAction(DECISION_TYPES.REVALIDATE, mission);
    assert.deepEqual(r1, r2);
  });

  it('ID2: createIterationMetadata produces unique iterations by number', () => {
    const mission = makeMission({ currentIteration: 2 });
    const session = { id: 'sess-1' };
    const meta1 = createIterationMetadata(mission, session);
    const mission2 = { ...mission, currentIteration: 3 };
    const meta2 = createIterationMetadata(mission2, session);
    assert.notEqual(meta1.number, meta2.number);
    assert.equal(meta1.number, 3);
    assert.equal(meta2.number, 4);
  });

  it('ID3: getLatestIteration returns the most recent metadata', () => {
    const session = { id: 'sess-1' };
    const mission = makeMission({ currentIteration: 0, iterationMetadata: [] });
    // Create entries properly via createIterationMetadata
    const meta1 = createIterationMetadata(mission, session);
    meta1.status = 'completed';
    mission.iterationMetadata = [meta1];

    const mission2 = { ...mission, currentIteration: 1, iterationMetadata: [...mission.iterationMetadata] };
    const meta2 = createIterationMetadata(mission2, session);
    meta2.status = 'completed';
    mission2.iterationMetadata.push(meta2);

    const latest = getLatestIteration(mission2);
    assert.equal(latest.number, 2);
  });
});

describe('Phase 9.2 — Revalidation Safety: Convergence Tracking', () => {
  it('C1: Improving trend detected with meaningful score increase', () => {
    const mission = makeMission({
      iterations: [
        makeIteration(1, 40, [makeFinding('f1', 'Bug A', 'high'), makeFinding('f2', 'Bug B', 'medium')]),
        makeIteration(2, 55, [makeFinding('f1', 'Bug A', 'high')])  // Bug B fixed → quality rises
      ]
    });
    const conv = analyzeConvergence(mission);
    assert.equal(conv.state, 'improving');
    assert.equal(conv.trend, 'improving');
    assert.ok(conv.scoreDelta >= MEANINGFUL_IMPROVEMENT_DELTA,
      `expected scoreDelta >= ${MEANINGFUL_IMPROVEMENT_DELTA}, got ${conv.scoreDelta}`);
  });

  it('C2: Declining trend detected with score drop', () => {
    const mission = makeMission({
      iterations: [
        makeIteration(1, 60, []),
        makeIteration(2, 50, [makeFinding('f1', 'New Bug', 'high')])  // -10
      ]
    });
    const conv = analyzeConvergence(mission);
    assert.equal(conv.trend, 'declining');
    assert.ok(conv.scoreDelta <= -MEANINGFUL_IMPROVEMENT_DELTA);
  });

  it('C3: Regression detected — new critical finding in latest iteration', () => {
    const mission = makeMission({
      iterations: [
        makeIteration(1, 60, [makeFinding('f1', 'Old Bug', 'medium')]),
        makeIteration(2, 55, [makeFinding('f1', 'Old Bug', 'medium'), makeFinding('f2', 'New Critical', 'critical')])
      ]
    });
    const conv = analyzeConvergence(mission);
    assert.equal(conv.state, 'regression');
    assert.equal(conv.criticalRegressions, true);
  });

  it('C4: Insufficient data with 0-1 iterations', () => {
    const mission = makeMission({ iterations: [] });
    const conv = analyzeConvergence(mission);
    assert.equal(conv.state, 'insufficient_data');
  });

  it('C5: Fixed findings tracked in convergence', () => {
    const mission = makeMission({
      iterations: [
        makeIteration(1, 40, [makeFinding('f1', 'Bug A'), makeFinding('f2', 'Bug B')]),
        makeIteration(2, 60, [makeFinding('f1', 'Bug A')])  // f2 fixed
      ]
    });
    const conv = analyzeConvergence(mission);
    assert.ok(conv.fixedCount >= 1, `expected >=1 fixed, got ${conv.fixedCount}`);
  });
});

describe('Phase 9.2 — Revalidation Safety: Loop Status API', () => {
  it('L1: getLoopStatus returns canRevalidate=false when at max iterations', () => {
    const mission = makeMission({
      currentIteration: 3,
      constraints: { maxIterations: 3 }
    });
    const status = getLoopStatus(mission);
    assert.equal(status.canRevalidate, false);
    assert.equal(status.maxIterations, 3);
  });

  it('L2: getLoopStatus returns canRevalidate=true when iterations remain', () => {
    const mission = makeMission({
      currentIteration: 1,
      iterations: [makeIteration(1, 50)],
      constraints: { maxIterations: 5 }
    });
    const status = getLoopStatus(mission);
    assert.equal(status.canRevalidate, true);
  });

  it('L3: getLoopStatus includes convergence and comparison', () => {
    const mission = makeMission({
      currentIteration: 2,
      iterations: [
        makeIteration(1, 40, [makeFinding('f1', 'Bug')]),
        makeIteration(2, 50, [makeFinding('f1', 'Bug')])
      ],
      constraints: { maxIterations: 5 }
    });
    const status = getLoopStatus(mission);
    assert.ok(status.convergence);
    assert.ok(status.comparison);
  });

  it('L4: getComparisonSummary returns baseline for single iteration', () => {
    const mission = makeMission({
      iterations: [makeIteration(1, 50, [makeFinding('f1', 'Bug')])]
    });
    const summary = getComparisonSummary(mission);
    assert.equal(summary.type, 'baseline');
    assert.equal(summary.iteration, 1);
  });
});

describe('Phase 9.2 — Revalidation Safety: Knowledge Integration', () => {
  it('K1: prepareKnowledgeForIteration returns hints and patterns', () => {
    const mission = makeMission({ targetUrl: 'http://localhost:9901' });
    const result = prepareKnowledgeForIteration(mission);
    assert.ok(typeof result.hints === 'string');
    assert.ok(Array.isArray(result.patterns));
    assert.ok(Array.isArray(result.patternIds));
  });

  it('K2: prepareKnowledgeForIteration is safe with empty targetUrl', () => {
    const mission = makeMission({ targetUrl: '' });
    const result = prepareKnowledgeForIteration(mission);
    assert.ok(typeof result.hints === 'string');
  });
});

describe('Phase 9.2 — Revalidation Safety: Constants & Invariants', () => {
  it('V1: DEFAULT_MAX_ITERATIONS is reasonable (≤ 20)', () => {
    assert.ok(DEFAULT_MAX_ITERATIONS > 0 && DEFAULT_MAX_ITERATIONS <= 20,
      `DEFAULT_MAX_ITERATIONS=${DEFAULT_MAX_ITERATIONS}`);
  });

  it('V2: NO_IMPROVEMENT_THRESHOLD is >= 2', () => {
    assert.ok(NO_IMPROVEMENT_THRESHOLD >= 2);
  });

  it('V3: MEANINGFUL_IMPROVEMENT_DELTA is positive', () => {
    assert.ok(MEANINGFUL_IMPROVEMENT_DELTA > 0);
  });

  it('V4: All STOP_REASONS are unique string values', () => {
    const values = Object.values(STOP_REASONS);
    assert.equal(values.length, new Set(values).size, 'STOP_REASONS values must be unique');
  });

  it('V5: All ITERATION_STATUS values are unique string values', () => {
    const values = Object.values(ITERATION_STATUS);
    assert.equal(values.length, new Set(values).size, 'ITERATION_STATUS values must be unique');
  });

  it('V6: DECISION_TYPES includes REVALIDATE', () => {
    assert.ok(DECISION_TYPES.REVALIDATE, 'REVALIDATE must exist in DECISION_TYPES');
  });

  it('V7: TERMINAL_DECISIONS excludes REVALIDATE and CONTINUE', () => {
    assert.equal(TERMINAL_DECISIONS.has(DECISION_TYPES.REVALIDATE), false);
    assert.equal(TERMINAL_DECISIONS.has(DECISION_TYPES.CONTINUE), false);
  });
});

describe('Phase 9.2 — Revalidation Safety: Revalidation Prompt', () => {
  it('RP1: Prompt includes iteration number', () => {
    const mission = makeMission({ currentIteration: 2 });
    const prompt = buildRevalidationPrompt(mission, makeIteration(1, 40, []), '');
    assert.ok(prompt.includes('ITERATION 3'));
  });

  it('RP2: Prompt includes target URL', () => {
    const mission = makeMission({ targetUrl: 'http://localhost:9903' });
    const prompt = buildRevalidationPrompt(mission, makeIteration(1, 40, []), '');
    assert.ok(prompt.includes('localhost:9903'));
  });

  it('RP3: Prompt handles empty previous iteration', () => {
    const mission = makeMission();
    const prompt = buildRevalidationPrompt(mission, null, '');
    assert.ok(prompt.length > 0);
  });

  it('RP4: Prompt includes improvement focus when available', () => {
    const mission = makeMission();
    const prevIter = {
      ...makeIteration(1, 40, []),
      improvementPrompt: 'Focus on authentication and form validation'
    };
    const prompt = buildRevalidationPrompt(mission, prevIter, '');
    assert.ok(prompt.includes('Improvement Focus'));
    assert.ok(prompt.includes('authentication'));
  });

  it('RP5: Prompt includes broken workflows from gap report', () => {
    const mission = makeMission({
      context: {
        phase8: {
          gapReport: {
            brokenWorkflows: [{ name: 'Login Flow', brokenSteps: ['submit'] }],
            incompleteWorkflows: [{ name: 'Checkout', untestedSteps: ['payment'] }]
          }
        }
      }
    });
    const prompt = buildRevalidationPrompt(mission, makeIteration(1, 40, []), '');
    assert.ok(prompt.includes('Login Flow'));
    assert.ok(prompt.includes('Checkout'));
    assert.ok(prompt.includes('payment'));
  });
});

describe('Phase 9.2 — Revalidation Safety: Stop Reason Priority', () => {
  it('SR1: MAX_ITERATIONS checked before NO_IMPROVEMENT', () => {
    // Both conditions true: at max AND no improvement
    const mission = makeMission({
      currentIteration: 3,
      iterations: [
        makeIteration(1, 50, [makeFinding('f1', 'Bug')]),
        makeIteration(2, 51, [makeFinding('f1', 'Bug')]),
        makeIteration(3, 52, [makeFinding('f1', 'Bug')])
      ],
      constraints: { maxIterations: 3 }
    });
    const reason = getStopReason(mission);
    // MAX_ITERATIONS is checked first → takes priority
    assert.equal(reason, STOP_REASONS.MAX_ITERATIONS);
  });

  it('SR2: Terminal status (pass) checked after iteration/convergence', () => {
    const mission = makeMission({
      status: 'completed',
      verdict: 'pass',
      currentIteration: 1,
      iterations: [makeIteration(1, 95, [])],
      constraints: { maxIterations: 5 }
    });
    const reason = getStopReason(mission);
    assert.equal(reason, STOP_REASONS.APPROVED);
  });
});

describe('Phase 9.2 — Revalidation Safety: Unknown Decision Handling', () => {
  it('U1: Unknown decision type returns action=none', () => {
    const mission = makeMission();
    const result = resolveAction('UNKNOWN_DECISION', mission);
    assert.equal(result.action, 'none');
    assert.equal(result.shouldRevalidate, false);
  });

  it('U2: CONTINUE is handled (C2: settled sessions dispatch a same-approach iteration)', () => {
    const mission = makeMission({ constraints: { maxIterations: 5 } });
    const result = resolveAction(DECISION_TYPES.CONTINUE, mission);
    assert.equal(result.action, 'continue');
    assert.equal(result.shouldStop, false);
    assert.equal(result.focusMode, 'continue'); // no findings-verify framing
    // Guards still apply — iteration-capped CONTINUE stops:
    const capped = makeMission({ constraints: { maxIterations: 1 }, currentIteration: 1 });
    const cappedResult = resolveAction(DECISION_TYPES.CONTINUE, capped);
    assert.equal(cappedResult.action, 'stop');
  });
});
