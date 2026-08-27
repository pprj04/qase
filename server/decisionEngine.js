/**
 * server/decisionEngine.js — Phase 4: The Decision Engine
 *
 * A standalone domain component that consumes evidence from the completed
 * quality assessment pipeline and produces an explicit, explainable decision.
 *
 * ARCHITECTURE:
 *
 *   ApplicationModel → Knowledge → Agent → Evidence → Findings → QualityAssessment
 *                                                                         ↓
 *                                                               ┌─────────────────┐
 *                                                               │ DECISION ENGINE │
 *                                                               └────────┬────────┘
 *                                                                        ↓
 *                                              ┌──────────┬──────────┬──────────┐
 *                                              ↓          ↓          ↓          ↓
 *                                           CONTINUE  REVALIDATE  ESCALATE  STOP_*
 *
 * PRINCIPLES:
 *   - The engine is a DECISION layer, not an execution layer.
 *   - It NEVER modifies raw evidence, findings, or browser state.
 *   - It NEVER silently alters quality scores.
 *   - It ONLY consumes structured inputs and produces a structured decision.
 *   - Historical knowledge is NEVER treated as ground truth.
 *   - Unknown ≠ Pass. Insufficient evidence ≠ Pass.
 *   - Deterministic policy logic is preferred. No LLM is used.
 *
 * @module server/decisionEngine
 */

/* ── Decision Types ──────────────────────────────────────────────── */

/**
 * All valid decision types. Validated against this allowlist —
 * no user-controlled or external value can introduce an unknown type.
 */
export const DECISION_TYPES = {
  CONTINUE: 'CONTINUE',
  REVALIDATE: 'REVALIDATE',
  INVESTIGATE: 'INVESTIGATE',
  REPLAN: 'REPLAN',
  ESCALATE: 'ESCALATE',
  STOP_PASS: 'STOP_PASS',
  STOP_FAIL: 'STOP_FAIL',
  STOP_BUDGET: 'STOP_BUDGET',
  STOP_BLOCKED: 'STOP_BLOCKED'
};

export const VALID_DECISION_TYPES = new Set(Object.values(DECISION_TYPES));

/**
 * Terminal decisions — once reached, no further action is expected.
 */
export const TERMINAL_DECISIONS = new Set([
  DECISION_TYPES.STOP_PASS,
  DECISION_TYPES.STOP_FAIL,
  DECISION_TYPES.STOP_BUDGET,
  DECISION_TYPES.STOP_BLOCKED
]);

/**
 * Policy version — bumped when policy rules change. Stored on every
 * decision for auditability. Allows future A/B comparison of policies.
 */
export const POLICY_VERSION = '4.0.0';

/* ── Budget Model ────────────────────────────────────────────────── */

/**
 * Default budget for a single mission. Can be overridden via mission
 * constraints. Each budget type has a limit and the engine tracks
 * consumption against it.
 */
export const DEFAULT_BUDGET = {
  // Wall-clock time in milliseconds. Default: 15 minutes.
  timeMs: 15 * 60 * 1000,
  // Maximum agent turns. Default: 50.
  actions: 50,
  // Maximum browser interactions (clicks, navigations, form fills).
  browserInteractions: 200,
  // Maximum LLM calls (estimated from agent turns — each turn ≈ 1 call).
  llmCalls: 60
};

/**
 * Threshold below which the budget is considered critical —
 * the engine will prefer STOP_BUDGET unless evidence is already sufficient.
 */
export const BUDGET_CRITICAL_THRESHOLD = 0.1; // 10% remaining

/* ── Decision Contract ───────────────────────────────────────────── */

/**
 * Creates a properly-formed decision record. Every decision goes through
 * this factory — no ad-hoc objects.
 *
 * @param {object} opts
 * @returns {object} A structured decision record
 */
export function createDecision(opts) {
  const {
    decision,
    reason,
    confidence,
    factors,
    evidenceRefs = [],
    knowledgeRefs = [],
    recommendedAction = null,
    missionId = null,
    sessionId = null,
    focusPayload = null
  } = opts;

  // Validate decision type against allowlist
  if (!VALID_DECISION_TYPES.has(decision)) {
    throw new Error(`Invalid decision type: "${decision}". Allowed: ${[...VALID_DECISION_TYPES].join(', ')}`);
  }

  // Validate reason — every decision must explain itself
  if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
    throw new Error(`Decision requires a meaningful reason (≥10 chars), got: "${reason}"`);
  }

  // Validate confidence
  const clampedConfidence = typeof confidence === 'number'
    ? Math.max(0, Math.min(1, confidence))
    : 0;

  // Validate factors object
  const safeFactors = factors && typeof factors === 'object' ? sanitizeFactors(factors) : {};

  return {
    id: `dec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    decision,
    reason: sanitizeText(reason),
    confidence: Math.round(clampedConfidence * 100) / 100,
    factors: safeFactors,
    evidenceRefs: Array.isArray(evidenceRefs) ? evidenceRefs.slice(0, 50) : [],
    knowledgeRefs: Array.isArray(knowledgeRefs) ? knowledgeRefs.slice(0, 50) : [],
    recommendedAction: recommendedAction ? sanitizeText(recommendedAction) : null,
    timestamp: new Date().toISOString(),
    policyVersion: POLICY_VERSION,
    missionId,
    sessionId,
    // C2: REPLAN carries a deterministic focus payload (focus areas + rationale
    // keys). Sanitized to strings-only so no session/mission object leaks into
    // a decision record. Only set for REPLAN decisions.
    focusPayload: decision === DECISION_TYPES.REPLAN && focusPayload
      ? sanitizeFocusPayload(focusPayload)
      : null
  };
}

/**
 * C2 — deterministic focus payload sanitizer. Keeps shape fixed, caps lists,
 * strings only, no nested objects from untrusted session/mission state.
 */
function sanitizeFocusPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const str = v => (typeof v === 'string' ? v.slice(0, 120) : null);
  const areas = Array.isArray(payload.focusAreas)
    ? payload.focusAreas.map(str).filter(Boolean).slice(0, 12)
    : [];
  const risks = Array.isArray(payload.riskAreas)
    ? payload.riskAreas.map(str).filter(Boolean).slice(0, 6)
    : [];
  const workflows = Array.isArray(payload.incompleteWorkflows)
    ? payload.incompleteWorkflows.map(str).filter(Boolean).slice(0, 8)
    : [];
  return {
    focusAreas: areas,
    riskAreas: risks,
    incompleteWorkflows: workflows,
    pagesExplored: typeof payload.pagesExplored === 'number' ? payload.pagesExplored : null,
    pagesDiscovered: typeof payload.pagesDiscovered === 'number' ? payload.pagesDiscovered : null,
    evidenceCompleteness: typeof payload.evidenceCompleteness === 'number' ? payload.evidenceCompleteness : null
  };
}

/* ── Decision History ────────────────────────────────────────────── */

/**
 * Maximum number of decisions stored per session. Bounded to prevent
 * uncontrolled history growth.
 */
export const MAX_DECISION_HISTORY = 100;

/**
 * Maintains bounded decision history for a session.
 * Stored on session.decisionHistory — initialized if absent.
 */
export function getDecisionHistory(session) {
  if (!session.decisionHistory) {
    session.decisionHistory = [];
  }
  return session.decisionHistory;
}

/**
 * Appends a decision to the session's history. Enforces MAX_DECISION_HISTORY.
 * Returns the updated history array.
 */
export function appendDecision(session, decision) {
  const history = getDecisionHistory(session);
  history.push(decision);
  // Trim to bounded size (keep the most recent)
  if (history.length > MAX_DECISION_HISTORY) {
    session.decisionHistory = history.slice(-MAX_DECISION_HISTORY);
  }
  return session.decisionHistory;
}

/**
 * Returns the last non-duplicate decision, or null.
 * Used for idempotency: if the inputs haven't changed, the same
 * decision should not be re-recorded.
 */
export function getLastDecision(session) {
  const history = getDecisionHistory(session);
  return history.length > 0 ? history[history.length - 1] : null;
}

/* ── Idempotency ─────────────────────────────────────────────────── */

/**
 * Signature for the set of inputs that determine a decision.
 * If the signature matches the last decision's signature, the engine
 * returns the cached decision rather than re-evaluating.
 *
 * This prevents decision spam when a polling endpoint is called repeatedly.
 */
export function computeInputSignature(input) {
  const sig = [
    `s:${input.qualityScore ?? 'null'}`,
    `v:${input.verdict ?? 'null'}`,
    `f:${input.findingCount ?? 0}`,
    `c:${input.criticalCount ?? 0}`,
    `h:${input.highCount ?? 0}`,
    `b:${input.budgetRemaining?.time ?? 'null'}`,
    `ba:${input.budgetRemaining?.actions ?? 'null'}`,
    `e:${input.evidenceCompleteness ?? 'null'}`,
    `kc:${input.knowledgeConflicts ?? 0}`,
    `au:${input.understandingConfidence ?? 'null'}`,
    `sc:${input.sessionCompleted ? 1 : 0}`,
    `as:${input.awaitingInput ? 1 : 0}`
  ];
  return sig.join('|');
}

/**
 * Checks if the current inputs would produce the same decision as the last
 * recorded one. If so, returns the cached decision for idempotency.
 *
 * @returns {object|null} The cached decision if inputs match, null otherwise.
 */
export function checkIdempotency(session, input) {
  const last = getLastDecision(session);
  if (!last || !last.factors?.inputSignature) return null;

  const currentSig = computeInputSignature(input);
  if (currentSig === last.factors.inputSignature) {
    return last;
  }
  return null;
}

/* ── Confidence Model ────────────────────────────────────────────── */

/**
 * Computes the Decision Engine's own confidence — distinct from quality score.
 *
 * The formula aggregates multiple orthogonal signals:
 *
 *   decisionConfidence = weighted average of:
 *     - evidenceCompleteness   (weight 0.25) — how much of the app was explored
 *     - findingConfidence      (weight 0.25) — avg confidence of findings
 *     - understandingConfidence (weight 0.20) — how well the app was understood
 *     - assessmentConfidence   (weight 0.15) — quality score as proxy
 *     - knowledgeAgreement     (weight 0.15) — do historical patterns agree?
 *
 * If any signal is missing, its weight is redistributed proportionally
 * among available signals.
 *
 * The result is clamped to [0, 1].
 *
 * @param {object} input - The decision input
 * @returns {{ value: number, basis: string[] }}
 */
export function computeDecisionConfidence(input) {
  const basis = [];

  // Collect available signals with their weights
  const signals = [];
  let totalWeight = 0;

  if (typeof input.evidenceCompleteness === 'number') {
    signals.push({ name: 'evidenceCompleteness', value: input.evidenceCompleteness, weight: 0.25 });
    totalWeight += 0.25;
    basis.push(`evidence completeness: ${(input.evidenceCompleteness * 100).toFixed(0)}%`);
  }

  if (typeof input.findingConfidence === 'number') {
    signals.push({ name: 'findingConfidence', value: input.findingConfidence, weight: 0.25 });
    totalWeight += 0.25;
    basis.push(`finding confidence: ${(input.findingConfidence * 100).toFixed(0)}%`);
  }

  if (typeof input.understandingConfidence === 'number') {
    signals.push({ name: 'understandingConfidence', value: input.understandingConfidence, weight: 0.20 });
    totalWeight += 0.20;
    basis.push(`app understanding: ${(input.understandingConfidence * 100).toFixed(0)}%`);
  }

  if (typeof input.qualityScore === 'number') {
    // Normalize quality score from 0-100 to 0-1
    const normalized = input.qualityScore / 100;
    signals.push({ name: 'assessmentConfidence', value: normalized, weight: 0.15 });
    totalWeight += 0.15;
    basis.push(`assessment score: ${input.qualityScore}/100`);
  }

  if (typeof input.knowledgeAgreement === 'number') {
    signals.push({ name: 'knowledgeAgreement', value: input.knowledgeAgreement, weight: 0.15 });
    totalWeight += 0.15;
    basis.push(`knowledge agreement: ${(input.knowledgeAgreement * 100).toFixed(0)}%`);
  }

  if (signals.length === 0) {
    return { value: 0, basis: ['no confidence signals available'] };
  }

  // Compute weighted average, normalizing against actual total weight used
  let sum = 0;
  for (const s of signals) {
    sum += (s.value * s.weight) / totalWeight;
  }

  // PENALIZE uncertainty: if fewer than 3 signals, reduce confidence
  // This implements the safety principle: less data = less certainty
  const signalCountPenalty = signals.length < 3 ? 0.85 : 1.0;
  const value = Math.max(0, Math.min(1, sum * signalCountPenalty));

  return { value: Math.round(value * 100) / 100, basis };
}

/* ── Safety Model ────────────────────────────────────────────────── */

/**
 * Safety rules that OVERRIDE any policy decision. These are hard rules
 * that cannot be bypassed by policy or configuration.
 *
 * Returns a correction if a safety rule fires, or null if safe.
 */
export function applySafetyOverride(decision, input) {
  // Safety Rule 1: No automatic STOP_PASS if confidence is low
  if (decision.decision === DECISION_TYPES.STOP_PASS) {
    const minConfidenceForPass = 0.60;
    if (decision.confidence < minConfidenceForPass) {
      return {
        ...decision,
        decision: DECISION_TYPES.CONTINUE,
        reason: `Safety override: confidence (${(decision.confidence * 100).toFixed(0)}%) is below the minimum threshold (${(minConfidenceForPass * 100).toFixed(0)}%) required for STOP_PASS. Evidence may be insufficient.`,
        factors: {
          ...decision.factors,
          safetyOverride: 'low_confidence_blocks_pass',
          originalDecision: DECISION_TYPES.STOP_PASS
        }
      };
    }
  }

  // Safety Rule 2: No STOP_PASS if evidence completeness is low
  if (decision.decision === DECISION_TYPES.STOP_PASS) {
    if (typeof input.evidenceCompleteness === 'number' && input.evidenceCompleteness < 0.50) {
      return {
        ...decision,
        decision: DECISION_TYPES.CONTINUE,
        reason: `Safety override: evidence completeness (${(input.evidenceCompleteness * 100).toFixed(0)}%) is below 50% threshold required for STOP_PASS. Exploration is incomplete.`,
        factors: {
          ...decision.factors,
          safetyOverride: 'insufficient_evidence_blocks_pass',
          originalDecision: DECISION_TYPES.STOP_PASS
        }
      };
    }
  }

  // Safety Rule 3: Critical findings must be surfaced
  if ((input.criticalCount ?? 0) > 0 && decision.decision === DECISION_TYPES.STOP_PASS) {
    return {
      ...decision,
      decision: DECISION_TYPES.STOP_FAIL,
      reason: `Safety override: ${input.criticalCount} critical finding(s) present — cannot STOP_PASS with unresolved critical issues.`,
      factors: {
        ...decision.factors,
        safetyOverride: 'critical_findings_block_pass',
        originalDecision: DECISION_TYPES.STOP_PASS
      }
    };
  }

  // Safety Rule 4: Awaiting-input agent cannot be force-stopped as PASS
  if (input.awaitingInput && decision.decision === DECISION_TYPES.STOP_PASS) {
    return {
      ...decision,
      decision: DECISION_TYPES.ESCALATE,
      reason: `Safety override: agent is awaiting user input — cannot auto-pass while the agent needs human guidance.`,
      factors: {
        ...decision.factors,
        safetyOverride: 'awaiting_input_blocks_pass',
        originalDecision: DECISION_TYPES.STOP_PASS
      }
    };
  }

  return null; // no safety override needed
}

/* ── Budget Tracking ─────────────────────────────────────────────── */

/**
 * Tracks budget consumption for a session.
 * Stored on session.budget — initialized on first evaluation.
 *
 * @param {object} session
 * @param {object} mission
 * @returns {object} The budget state: { timeMs, actions, browserInteractions, llmCalls, limits }
 */
export function trackBudget(session, mission) {
  if (!session.budget) {
    // Read limits from mission constraints or use defaults
    const constraints = mission?.constraints ?? {};
    const limits = {
      timeMs: constraints.maxDurationMs ?? DEFAULT_BUDGET.timeMs,
      actions: constraints.maxActions ?? DEFAULT_BUDGET.actions,
      browserInteractions: constraints.maxBrowserInteractions ?? DEFAULT_BUDGET.browserInteractions,
      llmCalls: constraints.maxLlmCalls ?? DEFAULT_BUDGET.llmCalls
    };

    // Estimate consumption from session state
    const elapsed = session.startedAt ? Date.now() - session.startedAt : 0;
    const actionCount = (session.activities?.length ?? 0);
    const browserSteps = (session.capturedSteps?.length ?? 0);
    // Each activity roughly corresponds to one LLM call (agent turn)
    const llmEstimate = Math.max(1, actionCount);

    session.budget = {
      timeUsed: elapsed,
      actionsUsed: actionCount,
      browserInteractionsUsed: browserSteps,
      llmCallsUsed: llmEstimate,
      limits
    };
  } else {
    // Update consumption without re-initializing limits
    const elapsed = session.startedAt ? Date.now() - session.startedAt : 0;
    session.budget.timeUsed = elapsed;
    session.budget.actionsUsed = session.activities?.length ?? 0;
    session.budget.browserInteractionsUsed = session.capturedSteps?.length ?? 0;
    session.budget.llmCallsUsed = Math.max(1, session.activities?.length ?? 0);
  }

  return session.budget;
}

/**
 * Computes remaining budget as a fraction of the limit (0 = exhausted, 1 = full).
 * Returns the minimum across all dimensions — the most constrained budget.
 */
export function computeBudgetRemaining(budget) {
  if (!budget || !budget.limits) return { time: 1, actions: 1, browser: 1, llm: 1, overall: 1 };

  const timeRemaining = Math.max(0, 1 - (budget.timeUsed / budget.limits.timeMs));
  const actionsRemaining = Math.max(0, 1 - (budget.actionsUsed / budget.limits.actions));
  const browserRemaining = Math.max(0, 1 - (budget.browserInteractionsUsed / budget.limits.browserInteractions));
  const llmRemaining = Math.max(0, 1 - (budget.llmCallsUsed / budget.limits.llmCalls));

  return {
    time: Math.round(timeRemaining * 100) / 100,
    actions: Math.round(actionsRemaining * 100) / 100,
    browser: Math.round(browserRemaining * 100) / 100,
    llm: Math.round(llmRemaining * 100) / 100,
    overall: Math.round(Math.min(timeRemaining, actionsRemaining, browserRemaining, llmRemaining) * 100) / 100
  };
}

/**
 * Formats remaining budget for human display.
 */
export function formatBudgetRemaining(budgetRemaining) {
  const pct = (n) => `${Math.round(n * 100)}%`;
  return {
    time: pct(budgetRemaining.time),
    actions: pct(budgetRemaining.actions),
    browser: pct(budgetRemaining.browser),
    llm: pct(budgetRemaining.llm),
    overall: pct(budgetRemaining.overall)
  };
}

/* ── Policy Evaluation ───────────────────────────────────────────── */

/**
 * Collects the input state for the decision engine from session, evidence,
 * and mission context. This is a READ-ONLY aggregation — it never modifies
 * its inputs.
 *
 * @param {object} session - The agent session
 * @param {object} evidence - The pipeline evidence object
 * @param {object} mission - The mission record (optional)
 * @returns {object} The structured decision input
 */
export function collectDecisionInput(session, evidence = {}, mission = null) {
  const findings = session.findings ?? [];
  const quality = evidence.missionResult?.quality ?? null;
  const appModel = session.appModel ?? evidence.appModel ?? null;

  // Finding stats
  const uniqueFindings = findings.filter(f => f.isDuplicate !== true);
  const criticalCount = findings.filter(f => f.severity === 'critical' && !f.isDuplicate).length;
  const highCount = findings.filter(f => f.severity === 'high' && !f.isDuplicate).length;
  const mediumCount = findings.filter(f => f.severity === 'medium' && !f.isDuplicate).length;
  const lowCount = findings.filter(f => f.severity === 'low' && !f.isDuplicate).length;
  const duplicateCount = findings.filter(f => f.isDuplicate === true).length;

  // Finding confidence
  const findingConfidence = uniqueFindings.length > 0
    ? uniqueFindings.reduce((s, f) => s + (typeof f.confidence === 'number' ? f.confidence : 0.5), 0) / uniqueFindings.length
    : null;

  // Evidence completeness — derived from captured steps, activities, coverage
  // A session with 0 steps hasn't explored at all; 20+ steps is thorough.
  const stepCount = session.capturedSteps?.length ?? 0;
  const activityCount = session.activities?.length ?? 0;
  // Distinct pages explored: from captured step URLs, falling back to the
  // app model's coverage record (steps may not be captured in every mode).
  const pagesExplored = new Set(
    (session.capturedSteps ?? []).map(s => s.url).filter(Boolean)
  ).size;
  const effectivePagesExplored = pagesExplored > 0
    ? pagesExplored
    : (appModel?.metadata?.coverage?.pagesExplored ?? 0);
  let evidenceCompleteness = null;
  if (stepCount === 0 && activityCount === 0) {
    evidenceCompleteness = 0;
  } else {
    // C2: completeness is BREADTH-aware, not just volume. The old
    // stepCount/30 heuristic rated 40 steps on ONE page as "complete"
    // — perfect completeness for a deeply-narrow exploration.
    // completeness = min(volume, breadth); breadth = distinct pages / 5,
    // floored at 0.2 once any page is explored (so volume still counts a
    // little). One page can never exceed 0.2 no matter the step count.
    const volumeScore = Math.min(1, stepCount / 30);
    const breadthScore = Math.min(1, pagesExplored / 5);
    evidenceCompleteness = Math.min(volumeScore, Math.max(breadthScore, pagesExplored > 0 ? 0.2 : 0));
  }

  // Understanding confidence from app model
  const understandingConfidence = appModel?.confidence?.overall?.value
    ?? appModel?.confidence?.overall
    ?? null;

  // Knowledge agreement: do historical patterns agree with current evidence?
  const knowledgeConflicts = evidence.knowledgeConflicts ?? session.pipeline?.summary?.knowledgeConflicts ?? [];
  const knowledgeValidations = evidence.knowledgeValidation ?? session.pipeline?.summary?.knowledgeValidation ?? [];
  const knowledgeConfirmed = knowledgeValidations.filter(v => v.status === 'confirmed').length;
  const knowledgeContradicted = knowledgeValidations.filter(v => v.status === 'contradicted').length;
  const knowledgeTotal = knowledgeValidations.length;
  let knowledgeAgreement = null;
  if (knowledgeTotal > 0) {
    knowledgeAgreement = Math.max(0, (knowledgeConfirmed - knowledgeContradicted) / knowledgeTotal);
  }

  // Budget tracking
  const budget = trackBudget(session, mission);
  const budgetRemaining = computeBudgetRemaining(budget);

  // Session state
  // 'idle' means the agent finished naturally (budget exhausted or agent decided
  // it was done) but the session wasn't formally closed to 'done'. Treat it as
  // completed so the decision engine evaluates terminal decisions (STOP/REVALIDATE).
  const sessionCompleted = session.status === 'done' || session.status === 'error' || session.status === 'interrupted' || session.status === 'idle';
  const awaitingInput = session.status === 'awaiting_input';
  const hasReport = !!session.report;

  // Coverage info from app model
  const coverage = appModel?.metadata?.coverage
    ?? (pagesExplored > 0 ? { pagesExplored } : null);

  // C2: TURN-based budget remaining. The legacy activity-based budget
  // (trackBudget) estimates from activities/capturedSteps against generic
  // limits — it can report "budget left" when the TURN pool is actually
  // spent, which produced wrong CONTINUE decisions on fully-spent sessions.
  // The authoritative budget is the mission turn pool: maxTurns vs turnCount
  // (the same arithmetic the controller's turnsRemaining uses).
  const authorizedTurns = Math.min(
    500,
    Number.isInteger(mission?.context?.maxTurns) && mission.context.maxTurns >= 1
      ? mission.context.maxTurns
      : (Number.isInteger(session.maxTurns) && session.maxTurns >= 1 ? session.maxTurns : 500)
  );
  const spentTurns = Number.isInteger(session.turnCount) && session.turnCount >= 0
    ? Math.min(session.turnCount, authorizedTurns)
    : 0;
  const turnBudgetRemaining = authorizedTurns > 0
    ? Math.max(0, (authorizedTurns - spentTurns) / authorizedTurns)
    : 0;
  const turnBudgetSpent = spentTurns >= authorizedTurns;

  // Mission objective
  const missionObjective = mission?.type ?? mission?.objectives?.[0] ?? null;

  // ── C2: risk + focus signals (previously prompt-only, now part of the
  // decision information selection). Deterministic extraction — never an
  // LLM judgment. All fields degrade to null/0 when absent.
  const riskAssessment = session.testContext?.riskAssessment ?? null;
  const riskLevel = riskAssessment?.level ?? null;
  const topRiskAreas = riskAssessment?.risks
    ? riskAssessment.risks.slice(0, 5).map(r => r.area).filter(Boolean)
    : [];
  const hasAdaptiveGuidance = Boolean(session.testContext?.adaptiveGuidance);
  const appModelPages = Array.isArray(appModel?.pages) ? appModel.pages : [];
  const pagesDiscovered = appModelPages.length;
  // Untested pages counted against the EFFECTIVE explored count (steps or
  // app-model coverage record — whichever is available).
  const untestedPageCount = pagesDiscovered > 0
    ? Math.max(0, pagesDiscovered - effectivePagesExplored)
    : 0;

  return {
    qualityScore: quality?.score ?? null,
    verdict: quality?.verdict ?? null,
    releaseReady: quality?.releaseReady ?? null,
    findingCount: findings.length,
    uniqueFindingCount: uniqueFindings.length,
    duplicateCount,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    findingConfidence,
    evidenceCompleteness,
    pagesExplored: effectivePagesExplored,
    stepCount,
    activityCount,
    understandingConfidence,
    knowledgeConflicts: knowledgeConflicts.length,
    knowledgeValidated: knowledgeTotal,
    knowledgeConfirmed,
    knowledgeContradicted,
    knowledgeAgreement,
    budget,
    budgetRemaining,
    sessionCompleted,
    awaitingInput,
    hasReport,
    coverage,
    missionObjective,
    mission,
    risk: quality?.risk ?? null,
    // C2 signal surface
    riskLevel,
    topRiskAreas,
    hasAdaptiveGuidance,
    pagesDiscovered,
    untestedPageCount,
    // C2: authoritative turn-pool budget (fraction remaining + boolean spent)
    turnBudgetRemaining,
    turnBudgetSpent,
    authorizedTurns,
    spentTurns
  };
}

/**
 * C2 — deterministic REPLAN focus derivation from decision input.
 * Mirrors buildReplanFocus (validationLoop.js) but works from already-
 * collected input. Never calls the LLM; pure extraction.
 */
function buildReplanFocusFromInput(input, session) {
  const appModel = session?.appModel ?? null;
  const pages = Array.isArray(appModel?.pages) ? appModel.pages : [];
  const exploredUrls = new Set((session?.capturedSteps ?? []).map(s => s.url).filter(Boolean));
  const untestedPages = pages
    .map(p => p?.path ?? p?.url ?? null)
    .filter(Boolean)
    .filter(p => ![...exploredUrls].some(u => String(u).includes(p)))
    .slice(0, 8);
  const riskAreas = (input.topRiskAreas ?? []).slice(0, 6);
  const incompleteWorkflows = (session?.pipeline?.summary?.gapReport?.incompleteWorkflows ?? [])
    .map(wf => wf?.name)
    .filter(Boolean)
    .slice(0, 8);
  const focusAreas = [
    ...untestedPages.map(p => `untested page: ${p}`),
    ...riskAreas.map(r => `risk area: ${r}`),
    ...incompleteWorkflows.map(w => `incomplete workflow: ${w}`)
  ];
  // C2: without an app model, breadth is still derivable from the session
  // itself — the explored-URL set tells us how narrow the approach was, and
  // standard QA areas (auth, forms, navigation) are the canonical next
  // focus when coverage is thin. Deterministic, no LLM.
  if (focusAreas.length === 0) {
    const explored = [...exploredUrls];
    const breadth = explored.length;
    if (breadth > 0 && breadth < 5) {
      focusAreas.push(`exploration stayed on ${breadth} page(s) — broaden to distinct sections of the application`);
    }
    focusAreas.push(
      'risk area: authentication and session flows',
      'risk area: forms and input validation',
      'risk area: navigation between sections'
    );
    if ((input.stepCount ?? 0) >= 20) {
      focusAreas.push(`high step volume (${input.stepCount} steps) with narrow coverage — vary entry points and links followed`);
    }
  }
  return {
    focusAreas: focusAreas.slice(0, 12),
    riskAreas,
    incompleteWorkflows,
    pagesExplored: input.pagesExplored ?? null,
    pagesDiscovered: input.pagesDiscovered ?? null,
    evidenceCompleteness: input.evidenceCompleteness ?? null
  };
}

/**
 * Evaluates the decision policy against the collected input.
 *
 * This is a DETERMINISTIC rule cascade — no LLM, no randomness.
 * Rules are evaluated in priority order. The first matching rule wins.
 *
 * Policy rules are documented and testable. To change behavior, change
 * the policy, not the engine.
 *
 * @param {object} input - Output of collectDecisionInput()
 * @param {object} session - The session (for history/idempotency)
 * @returns {object} A decision record (from createDecision)
 */
export function evaluatePolicy(input, session) {
  const {
    qualityScore,
    verdict,
    criticalCount,
    highCount,
    evidenceCompleteness,
    understandingConfidence,
    findingConfidence,
    knowledgeConflicts: conflictCount,
    knowledgeAgreement,
    budgetRemaining,
    sessionCompleted,
    awaitingInput,
    hasReport,
    pagesExplored,
    missionId,
    sessionId,
    findingCount,
    uniqueFindingCount,
    risk,
    missionObjective
  } = input;

  // Compute decision confidence
  const conf = computeDecisionConfidence(input);

  // Compute input signature for idempotency
  const inputSignature = computeInputSignature(input);

  // ── RULE CASCADE (priority order) ──

  // RULE 1: Agent is blocked / awaiting input and can't continue safely
  if (awaitingInput) {
    return createDecision({
      decision: DECISION_TYPES.ESCALATE,
      reason: `Agent is awaiting user input — requires human guidance to continue. Cannot proceed autonomously.`,
      confidence: conf.value,
      factors: {
        awaitingInput: true,
        inputSignature,
        confidenceBasis: conf.basis
      },
      recommendedAction: 'Provide credentials, answer the agent question, or abort the mission.',
      missionId,
      sessionId
    });
  }

  // RULE 2: Session has completed (agent finished, error, or interrupted)
  if (sessionCompleted) {
    // If the session is done, we need to make a terminal decision.
    // The quality assessment has already run, so we can reason about the verdict.

    // RULE 2a: Agent in error/interrupted state — cannot safely make a pass/fail
    if (session.status === 'error' || session.status === 'interrupted') {
      return createDecision({
        decision: DECISION_TYPES.STOP_BLOCKED,
        reason: `Session is in "${session.status}" state. Agent cannot continue safely and mission outcome cannot be determined automatically.`,
        confidence: conf.value,
        factors: { sessionStatus: session.status, inputSignature, confidenceBasis: conf.basis },
        recommendedAction: 'Investigate the error. Check agent logs and browser state. Retry or abort.',
        missionId,
        sessionId
      });
    }

  // C2: TURN-based budget exhausted check — the authoritative pool (mission
  // maxTurns vs turnCount). Legacy activity budget remains as a secondary
  // dimension but cannot mask a spent turn pool.
    if (budgetRemaining.overall <= BUDGET_CRITICAL_THRESHOLD || input.turnBudgetSpent === true) {
      // Budget exhausted but session completed — we have SOME evidence
      if (criticalCount > 0) {
        return createDecision({
          decision: DECISION_TYPES.STOP_FAIL,
          reason: `Mission budget critically low (${(budgetRemaining.overall * 100).toFixed(0)}% remaining) and ${criticalCount} critical issue(s) confirmed. Insufficient budget to continue investigation.`,
          confidence: conf.value,
          factors: { budgetRemaining: budgetRemaining.overall, criticalCount, inputSignature, confidenceBasis: conf.basis },
          recommendedAction: 'Review critical findings and decide whether to iterate or accept the current assessment.',
          missionId,
          sessionId
        });
      }
      return createDecision({
        decision: DECISION_TYPES.STOP_BUDGET,
        reason: `Mission budget exhausted (${(budgetRemaining.overall * 100).toFixed(0)}% remaining). Cannot continue exploration within remaining budget.`,
        confidence: conf.value,
        factors: { budgetRemaining: budgetRemaining.overall, inputSignature, confidenceBasis: conf.basis },
        recommendedAction: 'Review partial results. Consider a follow-up mission with a larger budget if coverage is insufficient.',
        missionId,
        sessionId
      });
    }

    // ── C2 RULES: budget remains — choose among CONTINUE / INVESTIGATE /
    // REPLAN (and legacy REVALIDATE) from the actual evidence state. These
    // sit BELOW budget-exhaustion and error handling (safe states dominate)
    // and BELOW the critical/knowledge-conflict legacy semantics, and ABOVE
    // sufficiency short-circuits. Order matters:
    //   criticals → STOP_FAIL (release blocker — legacy semantics preserved)
    //   knowledge contradictions → REVALIDATE (evidence precedence — legacy)
    //   non-critical findings → INVESTIGATE (C2)
    //   thin coverage, no findings → REPLAN (C2)
    //   barely started → CONTINUE (C2)
    // ──

    // Critical findings confirmed → STOP_FAIL (with safety consideration for escalation)
    if (criticalCount > 0) {
      // If confidence in findings is high, stop with a clear FAIL
      const criticalFindings = (session.findings ?? []).filter(f => f.severity === 'critical' && !f.isDuplicate);
      const evidenceRefs = criticalFindings.map(f => f.id).filter(Boolean);
      return createDecision({
        decision: DECISION_TYPES.STOP_FAIL,
        reason: `${criticalCount} critical finding(s) confirmed. Application is not ready for release: ${criticalFindings.slice(0, 3).map(f => f.title || 'unknown').join(', ')}.`,
        confidence: conf.value,
        factors: { criticalCount, highCount, verdict, inputSignature, confidenceBasis: conf.basis },
        evidenceRefs,
        recommendedAction: 'Fix critical issues before proceeding. Use the improvement prompt for targeted fixes.',
        missionId,
        sessionId
      });
    }

    // Knowledge conflicts suggest current evidence contradicts history
    // → current evidence wins, but revalidation is prudent (legacy).
    if (conflictCount > 0 && input.knowledgeContradicted > 0) {
      return createDecision({
        decision: DECISION_TYPES.REVALIDATE,
        reason: `${conflictCount} knowledge conflict(s) detected — current evidence contradicts historical patterns. Current evidence takes precedence, but revalidation is recommended to confirm.`,
        confidence: conf.value,
        factors: { knowledgeConflicts: conflictCount, knowledgeContradicted: input.knowledgeContradicted, inputSignature, confidenceBasis: conf.basis },
        recommendedAction: 'Re-run the mission or specific test cases to confirm the conflicting findings are stable.',
        missionId,
        sessionId
      });
    }

    // C2 RULE I: non-critical findings exist, coverage still thin, budget
    // remains → verify what we found while extending coverage. When coverage
    // is already sufficient the legacy verdict/sufficiency rules below decide
    // (pass_with_issues → STOP_PASS, fail verdict → STOP_FAIL).
    if (findingCount > 0 && evidenceCompleteness !== null && evidenceCompleteness < 0.50) {
      const verifyFindings = (session.findings ?? [])
        .filter(f => !f.isDuplicate)
        .sort((a, b) => (['critical', 'high', 'medium', 'low', 'info'].indexOf(a.severity ?? 'info'))
          - (['critical', 'high', 'medium', 'low', 'info'].indexOf(b.severity ?? 'info')))
        .slice(0, 10);
      const conflictNote = conflictCount > 0 && input.knowledgeContradicted > 0
        ? ` ${conflictCount} knowledge conflict(s) — current evidence takes precedence over history.`
        : '';
      return createDecision({
        decision: DECISION_TYPES.INVESTIGATE,
        reason: `${input.uniqueFindingCount ?? 0} unverified finding(s) (incl. ${criticalCount} critical, ${highCount} high) need confirmation before the mission concludes.${conflictNote} Budget remains (${(budgetRemaining.overall * 100).toFixed(0)}%).`,
        confidence: conf.value,
        factors: {
          uniqueFindingCount: input.uniqueFindingCount,
          criticalCount,
          highCount,
          knowledgeConflicts: conflictCount,
          budgetRemaining: budgetRemaining.overall,
          inputSignature,
          confidenceBasis: conf.basis
        },
        evidenceRefs: verifyFindings.map(f => f.id).filter(Boolean),
        recommendedAction: 'Verify the reported findings still reproduce, then broaden coverage if confirmed.',
        missionId,
        sessionId
      });
    }

    // C2 RULE R: no findings, effort spent, coverage stayed narrow → the
    // current approach is producing poor results. Change focus, not budget.
    if (findingCount === 0 && (input.stepCount ?? 0) >= 10 && evidenceCompleteness !== null && evidenceCompleteness < 0.50) {
      const focus = buildReplanFocusFromInput(input, session);
      return createDecision({
        decision: DECISION_TYPES.REPLAN,
        reason: `No findings after ${input.stepCount} steps across only ${pagesExplored ?? 0} page(s) (${(evidenceCompleteness * 100).toFixed(0)}% coverage). The current exploration approach is too narrow — re-plan focus toward uncovered areas. Budget remains (${(budgetRemaining.overall * 100).toFixed(0)}%).`,
        confidence: conf.value,
        factors: {
          stepCount: input.stepCount,
          pagesExplored,
          evidenceCompleteness,
          untestedPageCount: input.untestedPageCount ?? 0,
          budgetRemaining: budgetRemaining.overall,
          inputSignature,
          confidenceBasis: conf.basis
        },
        focusPayload: focus,
        recommendedAction: 'Re-run with focus on untested areas: ' + (focus?.focusAreas ?? []).slice(0, 4).join(', '),
        missionId,
        sessionId
      });
    }

    // C2 RULE C: barely started — near-zero evidence, no findings, most of
    // the budget untouched → keep going with the same approach.
    if ((input.stepCount ?? 0) < 10 && (input.stepCount ?? 0) + input.activityCount < 15) {
      return createDecision({
        decision: DECISION_TYPES.CONTINUE,
        reason: `Evidence collection has barely started (${input.stepCount ?? 0} steps, ${pagesExplored ?? 0} page(s)) and no findings yet. No reason to change approach — continue the mission as planned. Budget remains (${(budgetRemaining.overall * 100).toFixed(0)}%).`,
        confidence: conf.value,
        factors: { stepCount: input.stepCount, activityCount: input.activityCount, pagesExplored, budgetRemaining: budgetRemaining.overall, inputSignature, confidenceBasis: conf.basis },
        recommendedAction: 'Continue exploring the application per the original mission prompt.',
        missionId,
        sessionId
      });
    }

    // (C2: the critical → STOP_FAIL and knowledge-conflict → REVALIDATE
    // rules now live EARLIER in the cascade, before the INVESTIGATE/REPLAN/
    // CONTINUE C2 rules. The former duplicates here were dead code.)

    // Session completed with NO critical findings → assess sufficiency
    // Check if evidence is sufficient for a pass
    if (evidenceCompleteness !== null && evidenceCompleteness >= 0.50 && conf.value >= 0.60) {
      // Evidence is sufficient, confidence is acceptable, no critical issues
      if (verdict === 'pass' || (qualityScore !== null && qualityScore >= 85)) {
        return createDecision({
          decision: DECISION_TYPES.STOP_PASS,
          reason: `Evidence is sufficient (completeness: ${(evidenceCompleteness * 100).toFixed(0)}%), no critical issues found, and quality score (${qualityScore}) indicates acceptable quality. Mission objectives appear met.`,
          confidence: conf.value,
          factors: { evidenceCompleteness, qualityScore, verdict, inputSignature, confidenceBasis: conf.basis },
          recommendedAction: 'Mission complete. Review findings and consider recording knowledge for future missions.',
          missionId,
          sessionId
        });
      }
    }

    // Session completed but evidence may be insufficient
    if (evidenceCompleteness !== null && evidenceCompleteness < 0.50) {
      // Check if we have budget left to revalidate
      if (budgetRemaining.overall > BUDGET_CRITICAL_THRESHOLD) {
        return createDecision({
          decision: DECISION_TYPES.REVALIDATE,
          reason: `Evidence coverage is insufficient (${(evidenceCompleteness * 100).toFixed(0)}% < 50% threshold). Only ${pagesExplored ?? 0} page(s) explored. Budget remains (${(budgetRemaining.overall * 100).toFixed(0)}%) — revalidation recommended.`,
          confidence: conf.value,
          factors: { evidenceCompleteness, pagesExplored, budgetRemaining: budgetRemaining.overall, inputSignature, confidenceBasis: conf.basis },
          recommendedAction: 'Re-explore the application focusing on uncovered areas: authentication, forms, navigation, edge cases.',
          missionId,
          sessionId
        });
      }
      // No budget — have to stop with what we have
      return createDecision({
        decision: DECISION_TYPES.STOP_BUDGET,
        reason: `Evidence coverage is insufficient (${(evidenceCompleteness * 100).toFixed(0)}%) and budget is exhausted (${(budgetRemaining.overall * 100).toFixed(0)}% remaining). Cannot achieve sufficient coverage within remaining budget.`,
        confidence: conf.value,
        factors: { evidenceCompleteness, budgetRemaining: budgetRemaining.overall, inputSignature, confidenceBasis: conf.basis },
        recommendedAction: 'Review partial results and consider a follow-up mission with more budget.',
        missionId,
        sessionId
      });
    }

    // Session completed, no criticals, evidence seems sufficient but verdict is fail
    if (verdict === 'fail' && qualityScore !== null && qualityScore < 60) {
      return createDecision({
        decision: DECISION_TYPES.STOP_FAIL,
        reason: `Quality assessment indicates failure (score: ${qualityScore}, verdict: ${verdict}). ${highCount} high-severity issue(s) identified. Application requires fixes before release.`,
        confidence: conf.value,
        factors: { qualityScore, verdict, highCount, inputSignature, confidenceBasis: conf.basis },
        recommendedAction: 'Address high-severity findings and iterate.',
        missionId,
        sessionId
      });
    }

    // Default for completed session: pass_with_issues or similar
    if (verdict === 'pass_with_issues' || (qualityScore !== null && qualityScore >= 60 && qualityScore < 85)) {
      return createDecision({
        decision: DECISION_TYPES.STOP_PASS,
        reason: `Application quality is acceptable with issues (score: ${qualityScore}). ${highCount} high-severity, ${input.mediumCount ?? 0} medium-severity issue(s) identified but no critical blockers. Release-ready per assessment.`,
        confidence: conf.value,
        factors: { qualityScore, verdict, highCount, inputSignature, confidenceBasis: conf.basis },
        recommendedAction: 'Address medium/high findings in a follow-up iteration. Application is release-ready with known issues.',
        missionId,
        sessionId
      });
    }

    // Fallback for completed session
    return createDecision({
      decision: DECISION_TYPES.STOP_PASS,
      reason: `Mission completed with quality score ${qualityScore ?? 'N/A'} and verdict "${verdict ?? 'unknown'}". No critical blockers detected. Insufficient data for a stronger conclusion.`,
      confidence: conf.value,
      factors: { qualityScore, verdict, inputSignature, confidenceBasis: conf.basis },
      recommendedAction: 'Review findings and decide whether to iterate or accept.',
      missionId,
      sessionId
    });
  }

  // ── SESSION STILL RUNNING ──

  // RULE 3: Budget exhausted while session is still running
  if (budgetRemaining.overall <= BUDGET_CRITICAL_THRESHOLD) {
    return createDecision({
      decision: DECISION_TYPES.STOP_BUDGET,
      reason: `Mission budget critically low (${(budgetRemaining.overall * 100).toFixed(0)}% remaining). Continuing would risk exceeding resource limits. Halting to prevent resource exhaustion.`,
      confidence: conf.value,
      factors: { budgetRemaining: budgetRemaining.overall, inputSignature, confidenceBasis: conf.basis },
      recommendedAction: 'Review what was explored so far. Consider a follow-up mission with more budget.',
      missionId,
      sessionId
    });
  }

  // RULE 4: Agent cannot continue (error state, not awaiting input)
  if (session.status === 'error' || session.status === 'interrupted') {
    return createDecision(
      {
        decision: DECISION_TYPES.STOP_BLOCKED,
        reason: `Session is in error/interrupted state ("${session.status}"). Agent cannot continue safely.`,
        confidence: conf.value,
        factors: { sessionStatus: session.status, inputSignature, confidenceBasis: conf.basis },
        recommendedAction: 'Investigate the error. Check agent logs and browser state. Retry or abort.',
        missionId,
        sessionId
      }
    );
  }

  // RULE 5: Critical finding discovered mid-mission (high confidence)
  // This takes priority over insufficient evidence — a critical finding
  // is an escalation-worthy signal regardless of coverage.
  if (criticalCount > 0 && findingConfidence !== null && findingConfidence >= 0.7) {
    return createDecision({
      decision: DECISION_TYPES.ESCALATE,
      reason: `${criticalCount} high-confidence critical finding(s) discovered. Score so far: ${qualityScore ?? 'pending'}. Consider stopping early to address critical issues.`,
      confidence: conf.value,
      factors: { criticalCount, findingConfidence, qualityScore, inputSignature, confidenceBasis: conf.basis },
      recommendedAction: 'Review the critical findings. Continue exploring for completeness or stop to fix.',
      missionId,
      sessionId
    });
  }

  // RULE 6: Insufficient evidence with budget remaining → CONTINUE
  if (evidenceCompleteness !== null && evidenceCompleteness < 0.50 && budgetRemaining.overall > BUDGET_CRITICAL_THRESHOLD) {
    return createDecision({
      decision: DECISION_TYPES.CONTINUE,
      reason: `Evidence coverage is insufficient (${(evidenceCompleteness * 100).toFixed(0)}% < 50%). Only ${pagesExplored ?? 0} page(s) explored, ${input.stepCount ?? 0} steps taken. Budget remains (${(budgetRemaining.overall * 100).toFixed(0)}%). Continue exploration.`,
      confidence: conf.value,
      factors: { evidenceCompleteness, pagesExplored, stepCount: input.stepCount, budgetRemaining: budgetRemaining.overall, inputSignature, confidenceBasis: conf.basis },
      recommendedAction: 'Focus exploration on: authentication, forms, key user workflows, and untested page areas.',
      missionId,
      sessionId
    });
  }

  // RULE 7: Knowledge conflicts suggest the agent should re-examine something
  if (conflictCount > 0 && input.knowledgeContradicted > 0) {
    return createDecision({
      decision: DECISION_TYPES.REVALIDATE,
      reason: `${conflictCount} knowledge conflict(s) detected during exploration. Current evidence may contradict historical patterns. Re-examine the conflicting areas.`,
      confidence: conf.value,
      factors: { knowledgeConflicts: conflictCount, knowledgeContradicted: input.knowledgeContradicted, inputSignature, confidenceBasis: conf.basis },
      recommendedAction: 'Re-test the areas where historical knowledge conflicts with current evidence.',
      missionId,
      sessionId
    });
  }

  // RULE 8: Sufficient evidence and no blockers → CONTINUE (explore more for thoroughness)
  // The agent is still running, so we don't make a terminal decision.
  return createDecision({
    decision: DECISION_TYPES.CONTINUE,
    reason: `Exploration in progress. ${input.stepCount ?? 0} steps taken across ${pagesExplored ?? 0} page(s). Evidence completeness: ${evidenceCompleteness !== null ? `${(evidenceCompleteness * 100).toFixed(0)}%` : 'unknown'}. Budget: ${(budgetRemaining.overall * 100).toFixed(0)}% remaining. No blockers detected.`,
    confidence: conf.value,
    factors: { evidenceCompleteness, stepCount: input.stepCount, pagesExplored, budgetRemaining: budgetRemaining.overall, inputSignature, confidenceBasis: conf.basis },
    recommendedAction: 'Continue exploring. Focus on areas not yet covered.',
    missionId,
    sessionId
  });
}

/**
 * The main entry point for the Decision Engine.
 *
 * Collects inputs, checks idempotency, evaluates policy, applies safety
 * overrides, records to history, and returns the decision.
 *
 * @param {object} session - The agent session
 * @param {object} evidence - Pipeline evidence
 * @param {object} mission - Mission record
 * @returns {object} A decision record
 */
export function makeDecision(session, evidence = {}, mission = null) {
  // 1. Collect inputs (read-only)
  const input = collectDecisionInput(session, evidence, mission);

  // Attach missionId/sessionId to input for the policy evaluator
  input.missionId = mission?.id ?? null;
  input.sessionId = session?.id ?? null;

  // 2. Check idempotency — if inputs haven't changed, return cached decision
  const cached = checkIdempotency(session, input);
  if (cached) {
    return cached;
  }

  // 3. Evaluate the deterministic policy
  let decision = evaluatePolicy(input, session);

  // 4. Apply safety overrides (hard rules that can't be bypassed)
  const override = applySafetyOverride(decision, input);
  if (override) {
    decision = override;
  }

  // 5. Record to bounded history
  appendDecision(session, decision);

  return decision;
}

/* ── Fallback / Error Handling ───────────────────────────────────── */

/**
 * Called when the Decision Engine itself throws an error.
 *
 * SAFETY POLICY: Never silently mark a mission as PASS.
 * The fallback is conservative: ESCALATE (which requires human attention)
 * rather than STOP_PASS.
 *
 * @param {Error} error
 * @param {object} session
 * @param {object|null} mission
 * @returns {object} A safe fallback decision
 */
export function safeFallback(error, session, mission = null) {
  const decision = createDecision({
    decision: DECISION_TYPES.ESCALATE,
    reason: `Decision Engine encountered an error: ${sanitizeText(error?.message ?? 'unknown error')}. Escalating for safety — cannot determine mission outcome automatically.`,
    confidence: 0,
    factors: {
      error: true,
      errorMessage: sanitizeText(error?.message ?? 'unknown'),
      errorType: error?.name ?? 'Error',
      fallbackReason: 'decision_engine_error'
    },
    recommendedAction: 'Review the error and mission state manually. Do not auto-approve based on this decision.',
    missionId: mission?.id ?? null,
    sessionId: session?.id ?? null
  });
  // Record to history even for fallback
  if (session) {
    appendDecision(session, decision);
  }
  return decision;
}

/* ── Sanitization / Security ─────────────────────────────────────── */

/**
 * Sanitizes text for safe display. Strips control characters, limits length.
 * Prevents stored XSS in decision reason/recommendedAction fields.
 */
export function sanitizeText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/[\x00-\x1f\x7f]/g, '') // control chars
    .replace(/<script[^>]*>.*?<\/script>/gi, '') // script tags
    .replace(/<[^>]+>/g, '') // other HTML tags
    .slice(0, 1000); // max 1000 chars
}

/**
 * Sanitizes the factors object — ensures only primitive values,
 * prevents nested objects from carrying untrusted data.
 */
function sanitizeFactors(factors) {
  const safe = {};
  for (const [key, value] of Object.entries(factors)) {
    const safeKey = key.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50);
    if (typeof value === 'string') {
      safe[safeKey] = sanitizeText(value).slice(0, 200);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      safe[safeKey] = value;
    } else if (Array.isArray(value)) {
      safe[safeKey] = value.slice(0, 20);
    } else if (value && typeof value === 'object') {
      // Flatten one level — don't allow deep nesting
      for (const [k2, v2] of Object.entries(value).slice(0, 10)) {
        const sk2 = k2.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
        if (typeof v2 === 'string') safe[`${safeKey}_${sk2}`] = sanitizeText(v2).slice(0, 100);
        else if (typeof v2 === 'number' || typeof v2 === 'boolean') safe[`${safeKey}_${sk2}`] = v2;
      }
    }
  }
  return safe;
}

/**
 * Wraps makeDecision in a try/catch. If the engine throws, returns a
 * safe fallback instead of propagating the error.
 */
export function makeDecisionSafe(session, evidence = {}, mission = null) {
  try {
    return makeDecision(session, evidence, mission);
  } catch (error) {
    return safeFallback(error, session, mission);
  }
}

/* ── End of decisionEngine.js ────────────────────────────────────── */
