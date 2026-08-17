/**
 * server/validationLoop.js — Phase 5: Continuous Validation Loop
 *
 * Manages the iterative validation lifecycle:
 *
 *   Mission → Iteration 1 → Assess → Decide → Revalidate
 *          → Iteration 2 → Compare → Decide → Stop/Continue
 *
 * This module is the ACTION layer that sits between the Decision Engine
 * (which produces REVALIDATE/CONTINUE/etc.) and the agent execution
 * (which starts a new session for the next iteration).
 *
 * ARCHITECTURE:
 *
 *   Decision Engine (Phase 4)     → produces REVALIDATE/STOP_*
 *   Validation Loop (Phase 5)     → acts on REVALIDATE, manages iterations
 *   Agent (existing)              → explores the app for each iteration
 *
 * The Validation Loop does NOT replace the Decision Engine. It CONSUMES
 * decisions and translates them into actions. It is also responsible for:
 *   - Iteration limits (maxIterations, no-improvement detection)
 *   - Convergence tracking across iterations
 *   - Knowledge injection for each iteration
 *   - Improvement prompt injection for targeted re-exploration
 *
 * @module server/validationLoop
 */

import { compareIterations, calculateMissionQuality } from './devIntelligence.js';
import { queryKnowledge, generateExplorationHints, detectAppMetadata } from './knowledge.js';
import { getMission, updateMission, recordIteration, isTerminalStatus } from './missions.js';
import { TERMINAL_DECISIONS, DECISION_TYPES } from './decisionEngine.js';
import { computeEvidenceCoverage } from './evidenceGraph.js';

/* ── Constants ──────────────────────────────────────────────────── */

/**
 * Default maximum number of iterations per mission.
 * Can be overridden via mission.constraints.maxIterations.
 */
export const DEFAULT_MAX_ITERATIONS = 10;

/**
 * Number of consecutive non-improving iterations before the loop is
 * considered "not converging" and will recommend stopping.
 */
export const NO_IMPROVEMENT_THRESHOLD = 2;

/**
 * Minimum score delta to be considered "meaningful improvement".
 * Less than this delta is treated as "no meaningful change".
 */
export const MEANINGFUL_IMPROVEMENT_DELTA = 5;

/* ── Iteration Lifecycle ────────────────────────────────────────── */

/**
 * Iteration states — separate from mission status to avoid migration risk.
 * These track the validation loop's view of the iteration, not the
 * agent's session status.
 */
export const ITERATION_STATUS = {
  CREATED: 'created',
  RUNNING: 'running',
  ASSESSING: 'assessing',
  DECIDING: 'deciding',
  COMPLETED: 'completed',
  REVALIDATION_REQUIRED: 'revalidation_required',
  TERMINAL: 'terminal'
};

/**
 * Reasons the validation loop has stopped.
 */
export const STOP_REASONS = {
  APPROVED: 'approved',
  FAILED: 'failed',
  MAX_ITERATIONS: 'max_iterations',
  NO_IMPROVEMENT: 'no_improvement',
  ESCALATED: 'escalated',
  BUDGET_EXHAUSTED: 'budget_exhausted',
  BLOCKED: 'blocked',
  MANUAL_STOP: 'manual_stop'
};

/* ── Iteration Model ────────────────────────────────────────────── */

/**
 * Creates a formal iteration record for the validation loop.
 * This extends the existing recordIteration() shape with loop-specific
 * metadata (decision, comparison, convergence).
 *
 * Stored on mission.iterationMetadata[] — a separate array from the
 * existing mission.iterations[] to preserve backward compatibility.
 *
 * @param {object} mission
 * @param {object} session
 * @returns {object} Iteration metadata
 */
export function createIterationMetadata(mission, session) {
  return {
    number: (mission.currentIteration || 0) + 1,
    sessionId: session?.id ?? null,
    startedAt: Date.now(),
    completedAt: null,
    status: ITERATION_STATUS.CREATED,
    qualityScore: null,
    verdict: null,
    decision: null,
    changeSummary: null,
    duration: null
  };
}

/**
 * Gets or initializes the iteration metadata array on a mission.
 */
export function getIterationMetadata(mission) {
  if (!mission.iterationMetadata) {
    mission.iterationMetadata = [];
  }
  return mission.iterationMetadata;
}

/**
 * Gets the metadata for a specific iteration number.
 */
export function getIterationByNumber(mission, number) {
  const meta = getIterationMetadata(mission);
  return meta.find(m => m.number === number) ?? null;
}

/**
 * Gets the latest iteration metadata.
 */
export function getLatestIteration(mission) {
  const meta = getIterationMetadata(mission);
  return meta.length > 0 ? meta[meta.length - 1] : null;
}

/**
 * Updates an iteration metadata entry by number.
 */
export function updateIterationMetadata(mission, number, patch) {
  const meta = getIterationMetadata(mission);
  const entry = meta.find(m => m.number === number);
  if (entry) {
    Object.assign(entry, patch);
  }
  return entry;
}

/* ── Convergence Detection ──────────────────────────────────────── */

/**
 * Analyzes iteration history to detect convergence patterns.
 *
 * Uses measurable signals:
 *   - quality score delta over time
 *   - critical/high finding count trends
 *   - fixed vs new findings ratio
 *   - regression detection
 *
 * Returns a convergence assessment.
 *
 * @param {object} mission
 * @returns {object} { state, trend, scoreDelta, fixedCount, remainingCount, newCount, regressionCount, iterationsWithoutImprovement, detail }
 */
export function analyzeConvergence(mission) {
  const iterations = mission.iterations ?? [];
  const meta = getIterationMetadata(mission);

  // Need at least 2 iterations for comparison
  if (iterations.length < 2) {
    return {
      state: 'insufficient_data',
      trend: 'unknown',
      scoreDelta: null,
      fixedCount: 0,
      remainingCount: 0,
      newCount: 0,
      regressionCount: 0,
      iterationsWithoutImprovement: 0,
      detail: 'Need at least 2 iterations to assess convergence.'
    };
  }

  // Compare last two iterations — work from mission.iterations directly
  // so this function is testable without requiring the mission to be in the store
  const n = iterations.length;
  const pair = (n >= 2) ? {
    previous: iterations[n - 2],
    current: iterations[n - 1]
  } : null;
  if (!pair) {
    return {
      state: 'insufficient_data',
      trend: 'unknown',
      scoreDelta: null,
      fixedCount: 0,
      remainingCount: 0,
      newCount: 0,
      regressionCount: 0,
      iterationsWithoutImprovement: 0,
      detail: 'No comparison pair available.'
    };
  }

  const comparison = compareIterations(pair.previous.findings, pair.current.findings);
  const scoreDelta = comparison.scoreDelta;

  // Track iterations without meaningful improvement
  // Walk backwards through iterations counting how many had < MEANINGFUL_IMPROVEMENT_DELTA score gain
  let iterationsWithoutImprovement = 0;
  for (let i = iterations.length - 1; i >= 1; i--) {
    const curr = iterations[i].qualityScore ?? 0;
    const prev = iterations[i - 1].qualityScore ?? 0;
    const delta = curr - prev;
    if (delta < MEANINGFUL_IMPROVEMENT_DELTA) {
      iterationsWithoutImprovement++;
    } else {
      break; // Found improvement — stop counting
    }
  }

  // Determine convergence state
  const hasRegressions = comparison.newRegressionCount > 0;
  const hasCriticalRegressions = comparison.newRegressions?.some(r => r.severity === 'critical') ?? false;

  let state, trend;

  if (hasCriticalRegressions) {
    state = 'regression';
    trend = 'declining';
  } else if (hasRegressions) {
    state = 'regression';
    trend = comparison.trend === 'improving' ? 'stable' : 'declining';
  } else if (scoreDelta >= MEANINGFUL_IMPROVEMENT_DELTA) {
    state = 'improving';
    trend = 'improving';
  } else if (scoreDelta <= -MEANINGFUL_IMPROVEMENT_DELTA) {
    state = 'declining';
    trend = 'declining';
  } else if (iterationsWithoutImprovement >= NO_IMPROVEMENT_THRESHOLD) {
    state = 'no_improvement';
    trend = 'stable';
  } else {
    state = 'stable';
    trend = 'stable';
  }

  return {
    state,
    trend,
    scoreDelta,
    fixedCount: comparison.fixedCount,
    remainingCount: comparison.remainingCount,
    newCount: comparison.newRegressionCount,
    regressionCount: comparison.newRegressionCount,
    criticalRegressions: hasCriticalRegressions,
    iterationsWithoutImprovement,
    detail: buildConvergenceDetail(state, comparison, iterationsWithoutImprovement)
  };
}

/**
 * Builds a human-readable detail string for convergence state.
 */
function buildConvergenceDetail(state, comparison, iterationsWithoutImprovement) {
  switch (state) {
    case 'improving':
      return `Score improved by ${comparison.scoreDelta} points. ${comparison.fixedCount} finding(s) fixed, ${comparison.newRegressionCount} new regression(s).`;
    case 'declining':
      return `Score dropped by ${Math.abs(comparison.scoreDelta)} points. ${comparison.newRegressionCount} new regression(s) introduced.`;
    case 'regression':
      return `${comparison.newRegressionCount} regression(s) detected. ${comparison.newRegressions?.filter(r => r.severity === 'critical').length || 0} critical.`;
    case 'no_improvement':
      return `No meaningful improvement for ${iterationsWithoutImprovement} iteration(s). Score delta: ${comparison.scoreDelta}.`;
    case 'stable':
      return `Score is stable (delta: ${comparison.scoreDelta}). ${comparison.fixedCount} fixed, ${comparison.newRegressionCount} new.`;
    default:
      return 'Insufficient data for convergence analysis.';
  }
}

/* ── No-Improvement Detection ───────────────────────────────────── */

/**
 * Checks if the validation loop should stop due to no improvement.
 *
 * Returns true if the last NO_IMPROVEMENT_THRESHOLD iterations have
 * not shown meaningful score improvement.
 *
 * @param {object} mission
 * @returns {boolean}
 */
export function hasNoImprovement(mission) {
  const convergence = analyzeConvergence(mission);
  return convergence.state === 'no_improvement';
}

/**
 * Checks if the mission has reached its iteration limit.
 *
 * @param {object} mission
 * @returns {boolean}
 */
export function hasReachedIterationLimit(mission) {
  const limit = mission.constraints?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  return (mission.currentIteration ?? 0) >= limit;
}

/**
 * Returns the stop reason if the validation loop should terminate.
 * Returns null if the loop can continue.
 *
 * @param {object} mission
 * @returns {string|null} One of STOP_REASONS, or null if can continue.
 */
export function getStopReason(mission) {
  // Check iteration limit
  if (hasReachedIterationLimit(mission)) {
    return STOP_REASONS.MAX_ITERATIONS;
  }

  // Check no-improvement
  if (hasNoImprovement(mission)) {
    return STOP_REASONS.NO_IMPROVEMENT;
  }

  // Check terminal mission status with verdict
  if (isTerminalStatus(mission.status)) {
    if (mission.verdict === 'pass') {
      return STOP_REASONS.APPROVED;
    }
    if (mission.verdict === 'fail') {
      return STOP_REASONS.FAILED;
    }
    // pass_with_issues is NOT terminal — the loop can continue iterating
    // to try to resolve the remaining issues
  }

  return null; // Can continue
}

/* ── Action Contract ────────────────────────────────────────────── */

/**
 * Determines the action to take based on a decision from the Decision Engine.
 *
 * This is the clean abstraction between DECISION and ACTION:
 *
 *   Decision Engine → Decision (REVALIDATE, STOP_PASS, etc.)
 *   Validation Loop → Action (startRevalidation, stopLoop, etc.)
 *
 * For Phase 5, only REVALIDATE triggers an action (start a new iteration).
 * All other decisions result in no action (the loop terminates or waits).
 *
 * Future phases can add REGENERATE → external regeneration provider.
 *
 * @param {string} decisionType - The decision type from DECISION_TYPES
 * @param {object} mission
 * @returns {object} { action, reason, shouldRevalidate, shouldStop }
 */
export function resolveAction(decisionType, mission) {
  // Validate decision type
  if (!Object.values(DECISION_TYPES).includes(decisionType)) {
    return {
      action: 'none',
      reason: `Unknown decision type: ${decisionType}`,
      shouldRevalidate: false,
      shouldStop: false
    };
  }

  // REVALIDATE → start a new iteration.
  // Checked BEFORE getStopReason because the mission is already finalized as
  // 'completed' with a verdict at this point — getStopReason would return
  // APPROVED/FAILED and block the revalidation. The iteration limit check
  // below is the real safety guard.
  if (decisionType === DECISION_TYPES.REVALIDATE) {
    // Check iteration limit — first valid reason to block REVALIDATE
    if (hasReachedIterationLimit(mission)) {
      const limit = mission.constraints?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
      return {
        action: 'stop',
        reason: `REVALIDATE requested but max iterations (${limit}) reached`,
        shouldRevalidate: false,
        shouldStop: true,
        stopReason: STOP_REASONS.MAX_ITERATIONS
      };
    }
    // Check no-improvement — second valid reason to block REVALIDATE.
    // If multiple iterations have passed with no score improvement, continuing
    // wastes resources; the loop should terminate.
    if (hasNoImprovement(mission)) {
      return {
        action: 'stop',
        reason: `REVALIDATE requested but convergence shows no improvement across iterations`,
        shouldRevalidate: false,
        shouldStop: true,
        stopReason: STOP_REASONS.NO_IMPROVEMENT
      };
    }
    return {
      action: 'revalidate',
      reason: `Decision Engine returned REVALIDATE — starting next iteration`,
      shouldRevalidate: true,
      shouldStop: false
    };
  }

  // Terminal decisions → stop the loop
  if (TERMINAL_DECISIONS.has(decisionType)) {
    let stopReason = STOP_REASONS.APPROVED;
    if (decisionType === DECISION_TYPES.STOP_FAIL) stopReason = STOP_REASONS.FAILED;
    if (decisionType === DECISION_TYPES.STOP_BUDGET) stopReason = STOP_REASONS.BUDGET_EXHAUSTED;
    if (decisionType === DECISION_TYPES.STOP_BLOCKED) stopReason = STOP_REASONS.BLOCKED;

    return {
      action: 'stop',
      reason: `Decision Engine returned ${decisionType}`,
      shouldRevalidate: false,
      shouldStop: true,
      stopReason
    };
  }

  // ESCALATE → requires human intervention, stop the loop
  if (decisionType === DECISION_TYPES.ESCALATE) {
    return {
      action: 'escalate',
      reason: `Decision Engine returned ESCALATE — human intervention required`,
      shouldRevalidate: false,
      shouldStop: true,
      stopReason: STOP_REASONS.ESCALATED
    };
  }

  // CONTINUE → the session is still running, no action needed yet
  // (This shouldn't normally be called for completed sessions)
  return {
    action: 'wait',
    reason: `Decision Engine returned CONTINUE — session still in progress`,
    shouldRevalidate: false,
    shouldStop: false
  };
}

/* ── Revalidation Prompt Builder ────────────────────────────────── */

/**
 * Builds the agent prompt for a revalidation iteration.
 *
 * Unlike the initial mission prompt, this includes:
 *   - Awareness of previous findings
 *   - The improvement prompt (areas to focus on)
 *   - Historical knowledge hints (Phase 3)
 *
 * This ensures the agent doesn't just re-explore from scratch —
 * it validates previously found issues and focuses on areas needing
 * improvement.
 *
 * @param {object} mission
 * @param {object} previousIteration
 * @param {string} knowledgeHints
 * @returns {string} The complete agent task prompt
 */
export function buildRevalidationPrompt(mission, previousIteration, knowledgeHints = '') {
  const lines = [];

  // Base mission description
  const typeDescriptions = {
    full_audit: 'Perform a comprehensive quality audit of this application.',
    security: 'Focus on security validation.',
    ux: 'Focus on UX validation.',
    regression: 'Perform regression testing.',
    feature_gap: 'Analyze feature completeness.',
    accessibility: 'Focus on accessibility validation.'
  };

  lines.push(typeDescriptions[mission.type] || typeDescriptions.full_audit);
  lines.push('');
  lines.push(`Target: ${mission.targetUrl}`);
  lines.push('');
  lines.push(`This is ITERATION ${mission.currentIteration + 1} of a continuous validation loop.`);
  lines.push('Previous issues were found. Focus on verifying whether those issues are fixed, and check for regressions.');

  // Previous findings summary
  if (previousIteration?.findings?.length > 0) {
    lines.push('', '── Previously Found Issues ──');
    lines.push('The following issues were found in the previous iteration. Verify whether each has been fixed:');
    const sorted = [...previousIteration.findings].sort((a, b) => {
      const order = ['critical', 'high', 'medium', 'low', 'info'];
      return order.indexOf(a.severity) - order.indexOf(b.severity);
    });
    for (const f of sorted.slice(0, 15)) {
      lines.push(`- [${f.severity?.toUpperCase() ?? 'UNKNOWN'}] ${f.title || 'Untitled finding'}`);
    }
    if (previousIteration.findings.length > 15) {
      lines.push(`... and ${previousIteration.findings.length - 15} more`);
    }
  }

  // Improvement prompt from previous iteration
  if (previousIteration?.improvementPrompt) {
    lines.push('', '── Improvement Focus ──');
    lines.push('Key areas needing improvement based on the previous assessment:');
    lines.push(previousIteration.improvementPrompt.slice(0, 500));
  }

  // Broken / untested workflows from Phase 8 gap report
  const gapReport = mission?.context?.phase8?.gapReport;
  if (gapReport) {
    if (gapReport.brokenWorkflows?.length > 0) {
      lines.push('', '── Broken Workflows (steps that failed) ──');
      for (const wf of gapReport.brokenWorkflows) {
        lines.push(`- ${wf.name}: broken steps: ${(wf.brokenSteps || []).join(', ')}`);
      }
    }
    if (gapReport.incompleteWorkflows?.length > 0) {
      lines.push('', '── Untested Workflows (steps not yet validated) ──');
      for (const wf of gapReport.incompleteWorkflows) {
        lines.push(`- ${wf.name}: untested steps: ${(wf.untestedSteps || []).join(', ')}`);
      }
    }
  }

  // Mission objectives
  if (mission.objectives?.length) {
    lines.push('', 'Mission objectives:');
    for (const obj of mission.objectives) {
      lines.push(`- ${obj}`);
    }
  }

  // Knowledge hints (UNTRUSTED — Phase 3)
  if (knowledgeHints) {
    lines.push('', knowledgeHints);
  }

  return lines.join('\n');
}

/* ── Knowledge Integration ──────────────────────────────────────── */

/**
 * Queries knowledge and generates exploration hints for a revalidation
 * iteration. This is the same Phase 3 flow used at mission start, but
 * called for each subsequent iteration.
 *
 * @param {object} mission
 * @returns {{ hints: string, patterns: object[], patternIds: string[] }}
 */
export function prepareKnowledgeForIteration(mission) {
  try {
    const appMeta = detectAppMetadata({
      targetUrl: mission.targetUrl,
      missionName: mission.name || '',
      buildPrompt: mission.context?.buildPrompt || ''
    });
    const result = queryKnowledge(appMeta);
    const patterns = result.patterns ?? [];
    const hintsText = generateExplorationHints(patterns);
    const patternIds = patterns.map(p => p.id);

    // Phase 6: Include evidence coverage in the hints for revalidation
    let evidenceHints = '';
    try {
      const latestIteration = (mission.iterations ?? [])[0];
      if (latestIteration?.findings?.length > 0) {
        const coverage = computeEvidenceCoverage(latestIteration.findings);
        if (coverage.unverified > 0) {
          evidenceHints = `\n\n⚠️ Evidence coverage from previous iteration: ${coverage.coverage}% (${coverage.unverified} unverified findings). Prioritize gathering concrete evidence for previously unverified findings.`;
        }
      }
    } catch (evErr) {
      // Evidence coverage is informational — don't fail if unavailable
    }

    return { hints: hintsText + evidenceHints, patterns, patternIds };
  } catch (err) {
    // Knowledge query failure is non-fatal — return empty
    return { hints: '', patterns: [], patternIds: [] };
  }
}

/* ── Loop Status ────────────────────────────────────────────────── */

/**
 * Returns the complete validation loop status for a mission.
 *
 * This is the main read API for the validation loop state.
 * It aggregates iterations, comparison, convergence, and the
 * latest decision into a single status object.
 *
 * @param {object} mission
 * @returns {object}
 */
export function getLoopStatus(mission) {
  const iterations = mission.iterations ?? [];
  const convergence = analyzeConvergence(mission);
  const stopReason = getStopReason(mission);
  const latestIteration = iterations.length > 0 ? iterations[iterations.length - 1] : null;
  const latestMeta = getLatestIteration(mission);

  // Get comparison if available — use mission.iterations directly for testability
  let comparison = null;
  if (iterations.length >= 2) {
    const n = iterations.length;
    const prev = iterations[n - 2];
    const curr = iterations[n - 1];
    comparison = compareIterations(prev.findings, curr.findings);
  }

  // Get latest decision from latest session
  let latestDecision = null;
  if (latestMeta?.decision) {
    latestDecision = latestMeta.decision;
  }

  return {
    missionId: mission.id,
    currentIteration: mission.currentIteration ?? 0,
    totalIterations: iterations.length,
    maxIterations: mission.constraints?.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    canRevalidate: (!isTerminalStatus(mission.status) || mission.status === 'completed')
                   && !hasReachedIterationLimit(mission)
                   && !(getStopReason(mission)),
    stopReason,
    convergence,
    comparison,
    latestDecision,
    latestScore: latestIteration?.qualityScore ?? null,
    latestVerdict: latestIteration?.verdict ?? null,
    iterations: iterations.map(iter => ({
      number: iter.number,
      sessionId: iter.sessionId,
      qualityScore: iter.qualityScore,
      verdict: iter.verdict,
      releaseReady: iter.releaseReady,
      findingCount: iter.findings?.length ?? 0,
      ranAt: iter.ranAt
    }))
  };
}

/* ── Comparison Summary ─────────────────────────────────────────── */

/**
 * Produces a summary of the comparison between the last two iterations.
 * This extends the existing compareIterations() with additional context
 * for the validation loop (convergence, decision).
 *
 * @param {object} mission
 * @returns {object|null} Comparison summary, or null if insufficient data
 */
export function getComparisonSummary(mission) {
  const iterations = mission.iterations ?? [];
  if (iterations.length === 0) return null;
  if (iterations.length === 1) {
    return {
      type: 'baseline',
      iteration: 1,
      message: 'First iteration — no previous run to compare against.',
      currentScore: iterations[0].qualityScore,
      verdict: iterations[0].verdict,
      findingCount: iterations[0].findings?.length ?? 0
    };
  }

  // Use iterations directly for testability (no store dependency)
  const n = iterations.length;
  const pairResolved = n >= 2 ? { previous: iterations[n - 2], current: iterations[n - 1] } : null;
  if (!pairResolved) return null;

  const comparison = compareIterations(pairResolved.previous.findings, pairResolved.current.findings);
  const convergence = analyzeConvergence(mission);

  return {
    type: 'comparison',
    iteration: pairResolved.current.number,
    comparison,
    convergence,
    productQuality: {
      releaseReady: pairResolved.current.releaseReady,
      confidence: calculateMissionQuality(pairResolved.current.findings).confidence,
      risk: calculateMissionQuality(pairResolved.current.findings).risk
    }
  };
}

/* ── End of validationLoop.js ───────────────────────────────────── */
