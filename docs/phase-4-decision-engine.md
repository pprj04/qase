# Phase 4 — Decision Engine

## 1. Purpose

The Decision Engine is a standalone domain component that evaluates the complete
state of a QA mission — application understanding, evidence, findings, quality
assessment, historical knowledge, budget, and session state — and produces an
explicit, explainable decision about what QASE should do next.

It replaces the implicit `score >= 60 ? pass : fail` logic with a structured,
policy-driven decision cascade that reasons over multiple signals.

## 2. Problem

Before Phase 4, the system had no real Decision Engine:

- **Mission verdict was a pure score calculation**: `score = 100 - Σ(severity × confidence)`, with thresholds at 85 (pass) and 60 (pass_with_issues).
- **No budget awareness**: missions could run indefinitely until the agent stopped.
- **No decision history**: there was no audit trail of "why did QASE decide this?"
- **No convergence detection**: the system couldn't tell if exploration was sufficient.
- **No safety rules**: a high score with low evidence completeness would still pass.
- **No separation of facts from decisions**: the quality assessment IS the decision.

## 3. Architecture

```
                    ┌────────────────────┐
                    │ Application Model  │  (Phase 2)
                    └─────────┬──────────┘
                              ↓
                    ┌────────────────────┐
                    │ Historical         │  (Phase 3)
                    │ Knowledge          │
                    └─────────┬──────────┘
                              ↓
                    ┌────────────────────┐
                    │ Agent Exploration  │
                    └─────────┬──────────┘
                              ↓
                    ┌────────────────────┐
                    │ Evidence Pipeline  │
                    └─────────┬──────────┘
                              ↓
                    ┌────────────────────┐
                    │ Quality Assessment │  (mission_finalize)
                    └─────────┬──────────┘
                              ↓
                    ┌────────────────────┐
                    │ DECISION ENGINE    │  (Phase 4 — NEW)
                    └─────────┬──────────┘
                              ↓
             ┌────────────────┼────────────────┐
             ↓                ↓                ↓
          CONTINUE         REVALIDATE        ESCALATE
             │                │                │
             └────────────────┼────────────────┘
                              ↓
                            STOP_*
```

### Capability Pipeline Position

The Decision Engine is registered as capability `decision_engine` in the pipeline:

```
workflow_save → test_generation → schedule_create → dev_intelligence
→ application_understanding → feature_gap → mission_finalize
→ decision_engine → knowledge_write
```

- **dependsOn**: `['mission_finalize']` — runs after quality assessment completes.
- **producesEvidence**: `['decision']` — emits the decision record.
- **knowledge_write** depends on `decision_engine` — knowledge is written after the decision is recorded.

## 4. Inputs

The `collectDecisionInput()` function reads (never modifies) these signals:

| Input | Source | Description |
|-------|--------|-------------|
| qualityScore | evidence.missionResult.quality.score | 0–100 score from quality assessment |
| verdict | evidence.missionResult.quality.verdict | pass / pass_with_issues / fail |
| findings | session.findings | Array of finding objects |
| criticalCount | derived | Count of non-duplicate critical findings |
| highCount | derived | Count of non-duplicate high findings |
| findingConfidence | derived | Average confidence of unique findings |
| evidenceCompleteness | derived | Coverage heuristic: min(1, stepCount/30) |
| understandingConfidence | session.appModel.confidence.overall | App understanding confidence |
| knowledgeConflicts | evidence.knowledgeConflicts | Conflicts from knowledge validation |
| knowledgeAgreement | derived | (confirmed - contradicted) / total |
| budget | session.budget | Time, actions, browser, LLM consumption |
| sessionStatus | session.status | running / done / error / awaiting_input |

## 5. Outputs

Every decision is a structured record:

```javascript
{
  id: "dec_<timestamp>_<random>",
  decision: "STOP_FAIL",           // one of 7 types
  reason: "2 critical findings confirmed...",  // always ≥10 chars
  confidence: 0.72,                // 0–1, NOT quality score
  factors: {
    criticalCount: 2,
    highCount: 1,
    evidenceCompleteness: 0.85,
    budgetRemaining: 0.65,
    inputSignature: "s:30|v:fail|f:5|...",
    confidenceBasis: ["evidence completeness: 85%", ...],
    // safetyOverride if applicable
  },
  evidenceRefs: ["f1", "f2"],      // finding IDs referenced
  knowledgeRefs: ["kp_abc"],       // knowledge pattern IDs
  recommendedAction: "Fix critical issues...",
  timestamp: "2025-01-15T10:30:00Z",
  policyVersion: "4.0.0",
  missionId: "mission-123",
  sessionId: "session-456"
}
```

## 6. Decision Types

| Type | Terminal | Description |
|------|----------|-------------|
| CONTINUE | No | Agent should keep exploring; budget remains |
| REVALIDATE | No | Re-examine conflicting or insufficient evidence |
| ESCALATE | No | Human attention needed (critical mid-mission or agent blocked) |
| STOP_PASS | Yes | Mission complete; quality is acceptable |
| STOP_FAIL | Yes | Mission failed; blocking issues confirmed |
| STOP_BUDGET | Yes | Budget exhausted; cannot continue |
| STOP_BLOCKED | Yes | Agent cannot proceed safely (error/interrupted) |

All types are validated against a `Set` allowlist — no user-controlled or external value can introduce an unknown type.

## 7. Policy

The policy is a **deterministic rule cascade** — no LLM, no randomness.
Rules are evaluated in priority order; the first matching rule wins.

### Priority Order (completed sessions)
1. **Error/interrupted state** → STOP_BLOCKED
2. **Budget critical** → STOP_BUDGET (or STOP_FAIL if criticals exist)
3. **Knowledge contradictions** → REVALIDATE
4. **Critical findings** → STOP_FAIL
5. **Sufficient evidence + high score** → STOP_PASS
6. **Insufficient evidence + budget** → REVALIDATE
7. **Insufficient evidence + no budget** → STOP_BUDGET
8. **Fail verdict (score < 60)** → STOP_FAIL
9. **Pass with issues** → STOP_PASS

### Priority Order (running sessions)
1. **Awaiting input** → ESCALATE
2. **Error/interrupted** → STOP_BLOCKED
3. **Budget critical** → STOP_BUDGET
4. **High-confidence critical mid-mission** → ESCALATE
5. **Insufficient coverage + budget** → CONTINUE
6. **Knowledge conflicts** → REVALIDATE
7. **Default** → CONTINUE

## 8. Confidence Model

Decision confidence ≠ quality score. It aggregates 5 orthogonal signals:

```
decisionConfidence = weighted average of:
  evidenceCompleteness   (weight: 0.25)
  findingConfidence      (weight: 0.25)
  understandingConfidence (weight: 0.20)
  assessmentConfidence   (weight: 0.15) — qualityScore normalized
  knowledgeAgreement     (weight: 0.15)
```

If fewer than 3 signals are available, a 0.85 uncertainty penalty is applied.

## 9. Safety Model

Four hard safety overrides that cannot be bypassed:

1. **Low confidence blocks pass**: STOP_PASS → CONTINUE if confidence < 0.60
2. **Insufficient evidence blocks pass**: STOP_PASS → CONTINUE if completeness < 50%
3. **Critical findings block pass**: STOP_PASS → STOP_FAIL if criticals exist
4. **Awaiting input blocks pass**: STOP_PASS → ESCALATE if agent needs human input

**Core principle: Unknown ≠ Pass. Insufficient evidence ≠ Pass.**

## 10. Budget

The engine tracks 4 budget dimensions:

| Budget | Default Limit | Source |
|--------|--------------|--------|
| Time | 15 minutes (900,000ms) | mission.constraints.maxDurationMs |
| Actions | 50 | mission.constraints.maxActions |
| Browser interactions | 200 | mission.constraints.maxBrowserInteractions |
| LLM calls | 60 | mission.constraints.maxLlmCalls |

Remaining budget = min across all dimensions. Critical threshold at 10% remaining.

## 11. Audit Trail

Every decision records:
- **Why** (reason — ≥10 chars, human-readable)
- **What factors** influenced it (key factors + confidence basis)
- **What evidence** it references (evidenceRefs)
- **What knowledge** influenced it (knowledgeRefs)
- **When** (timestamp)
- **Under what policy** (policyVersion)
- **What it recommends** (recommendedAction)

Decision history is bounded at MAX_DECISION_HISTORY=100 entries per session.

## 12. API

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/sessions/:id/decision` | Read | Latest decision + history count |
| GET | `/api/sessions/:id/decisions` | Read | Full decision history |
| GET | `/api/missions/:id/decisions` | Read | Decisions across all mission sessions |

All endpoints are read-only. No destructive decision manipulation is exposed.

## 13. UI

A minimal panel added to the Analysis tab (between Knowledge and the action buttons):

- **Decision badge** with color-coded type (CONTINUE=blue, REVALIDATE=amber, ESCALATE=orange, STOP_PASS=green, STOP_FAIL=red, STOP_BUDGET=purple, STOP_BLOCKED=gray)
- **Confidence percentage**
- **"Why?"** reason block
- **Key Factors** grid
- **Confidence Basis** list
- **Recommended Action**
- **Safety Override** notice (if applicable)
- **Decision History** (last 10, compact)
- **Policy version + timestamp**

## 14. Testing

- **61 unit tests**: decision types, contract validation, confidence, budget, history, idempotency, safety overrides, fallback, security, auditability, evidence separation
- **13 integration tests**: capability registration, pipeline order, full mission→assessment→decision flow, knowledge conflicts, history accumulation, decision isolation
- **7 E2E scenarios**: continue (insufficient coverage), stop_fail (criticals), revalidate (conflicts), stop_pass (clean), stop_budget, stop_blocked, escalate
- **Regression**: 517/517 tests pass (Phase 1–3 preserved)

## 15. Failure Handling

If the Decision Engine throws an error, `makeDecisionSafe()` returns:

- **Decision**: ESCALATE
- **Confidence**: 0
- **Reason**: "Decision Engine encountered an error: ..."
- **Factor**: `fallbackReason: 'decision_engine_error'`

**Never silently mark a mission as PASS on engine failure.**

## 16. Scalability

The engine is designed as a standalone domain component:

- **No global mutable state** — all state lives on the session object
- **No direct database coupling** — reads from session/evidence/mission objects
- **No direct Playwright coupling** — never touches browser state
- **No direct UI coupling** — communicates via API + session.decisionHistory
- **No hard-coded mission-specific logic** — all thresholds are configurable via mission constraints
- **O(n) complexity** — iterates findings once, O(1) for each check
- **0.023ms average latency** per decision (measured over 1000 iterations)

## 17. LLM Usage

**The Decision Engine does NOT use an LLM.**

All decisions are deterministic policy evaluations. This is intentional:
- Decisions must be reproducible and auditable
- LLM output is advisory, not authoritative — a policy cascade is more reliable
- O(1) latency vs LLM latency
- No token cost
- No risk of prompt injection affecting decisions

If future phases require LLM-assisted decisions for ambiguous cases, the engine
is designed to isolate it behind an interface with structured output validation
and deterministic safety overrides.

## 18. Future Extension Points

- **Continuous validation loop** (Phase 5+): CONTINUE/REVALIDATE decisions can trigger re-exploration
- **Mission-specific policies**: custom policy objects per mission type (web/API/mobile)
- **Decision analytics**: aggregate decisions across missions for trend analysis
- **Policy versioning**: A/B compare policy versions using stored policyVersion
- **LLM-assisted ambiguous decisions**: isolated behind interface, advisory only
