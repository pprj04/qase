# C2 — Autonomy Baseline (Phase 0, read-only)

**Date:** 2026-08-26 · **Tree:** `version-M` @ C1 (`e7b0cb3`), clean, up to date with origin
**Method:** read-only inspection (no code modified). All claims carry file:line evidence.

---

## 1. What is ALREADY autonomous (live in production)

### 1.1 The decision loop — end-to-end runtime path

```
mission settles (report filed or turn-limited close-out)
  → qaTools.js:164 runAutonomyPipeline  ── or ──  index.js:3686 finalizeMissionFromSession
  → capabilities.js:508 autonomyGateForCapabilities  (mission_finalize capability)
  → autonomyBridge.js:28 gate → index.js:3638 attemptAutonomyBeforeFinalize
  → autonomyController.js:90 runAutonomyDecision
       1. makeDecisionSafe (decisionEngine.js:897) — DETERMINISTIC rule cascade, no LLM
       2. resolveAction (validationLoop.js:378) — decision → action mapping
       3. Budget authority (autonomyController.js:117-142) — REQUEST/GRANT/DENY
       4. dispatchRevalidation hook (index.js:4211-4269) — in-process, shared handler
  → revalidateMissionByIdHandlerInner (index.js:2892) — ALL guards re-run
       target re-validation · iteration limit · no-improvement · turn-pool debit
  → new iteration session (index.js:2985-3075) — prompt aware of previous findings
  → decision trace recorded (decisionTraces.js:98) — 13-field schema
```

- **Autonomy is default ON** (`QASE_AUTONOMY !== 'off'`, autonomyController.js:40-42);
  per-mission opt-out via `context.autonomy === false` (l.49-53).
- **Exactly one production caller of `resolveAction`**: autonomyController.js:112
  (the B1-era zero-callers defect is fixed). A second call site (l.197) belongs to
  `runAutonomyDecisionSync`, which has zero callers (§3).
- **The decision changes execution**: a granted REVALIDATE launches a real new
  iteration (deferred finalization, index.js:3643-3649 / capabilities.js:509-513);
  a STOP_FAIL escalates to `finalizeMission(..., status:'failed')` (index.js:3670).

### 1.2 Decision vocabulary (decisionEngine.js:37-44)

`CONTINUE · REVALIDATE · ESCALATE · STOP_PASS · STOP_FAIL · STOP_BUDGET · STOP_BLOCKED`

Deterministic rule cascade (evaluatePolicy, decisionEngine.js:593-865): awaiting-input →
ESCALATE; error/interrupted → STOP_BLOCKED; budget-critical → STOP_FAIL/STOP_BUDGET;
knowledge conflicts → REVALIDATE; criticals → STOP_FAIL; sufficient evidence + pass →
STOP_PASS; insufficient evidence + budget → REVALIDATE; insufficient + no budget →
STOP_BUDGET; fail verdict → STOP_FAIL; pass_with_issues → STOP_PASS.

**INVESTIGATE / REPLAN do not exist as decision types.** The closest live semantics:
REVALIDATE ("re-examine conflicting areas / re-explore uncovered areas") and the
revalidation prompt's improvement/gap sections. See §4 for the C2 gap analysis.

**Unreachable-in-production rules:** the "session still running" branch
(RULE 3–8: STOP_BUDGET-mid-run, mid-run ESCALATE, CONTINUE ×2) can never fire because
the autonomy gate only runs on **settled** sessions (autonomyController.js:97). In
production, `CONTINUE` is currently unreachable.

### 1.3 Decision traces

- 13 fields + `ts` (decisionTraces.js:98-131): `decision_id, mission_id, iteration, ts,
  state, signals_used (KEYS ONLY — never values, no chain-of-thought), candidate_action,
  selected_action, reason (≤300), budget_before, budget_requested, budget_granted,
  result, next_decision`.
- Persisted: `.qase/decision-traces.json` (atomic write, 400 ms debounce, shutdown
  flush, corrupt → empty). Cap: 50 missions × 100 decisions.
- Exposed: `GET /api/v1/missions/:id/decision-trace` (token, index.js:3138) and
  `GET /api/v1/integration/missions/:id/decision-trace` (HMAC, index.js:1825).

### 1.4 Budget enforcement (the "steering wheel, not fuel pump" invariant)

- **Agent can never self-grant**: autonomyController never writes `session.maxTurns`
  (header rule l.8-14; enforced by source-regex test b2-decision-wiring.test.js:146-152).
- **Pool semantics**: revalidation debits the mission pool —
  `session.maxTurns = min(missionMaxTurns,500) − Σ turnCount(all mission sessions)`
  (index.js:3000-3011); ground truth recomputed at dispatch; 409 `budget_exhausted`
  pre-check at 2957-2968. A mission authorized for N turns can never spend > N total.
- **Entry validation**: 1–500 on create (index.js:1630-1639, 2370-2380); config clamp
  (config.js:277-278); default 120 (operator decision; 500 = absolute ceiling).
- **Agent-side hard abort**: `effectiveMaxTurns` (agent.js:179-181) + cumulative
  `turnCount` across SDK calls (B2 fix, agent.js:408-433) + abort at turnLimit+1
  event (l.567-588). One turn = one `assistant_turn_start` event (documented l.156-178).
- **Autonomy budget answer**: `turnsRemaining = min(session.maxTurns,500) −
  session.turnCount` (autonomyController.js:55-58); REVALIDATE with remaining ≤ 0 →
  DENIED → `denied_and_stopped` trace (l.62-78).

### 1.5 Deterministic close-out (LLM-free)

`finalizeTurnLimitedRun` (agent.js:766-833): compiles an honest report from collected
evidence with ZERO model turns; sets `_deterministicCloseOut` (skips
`enhanceGapsWithLLM`, capabilities.js:453) and `_closeOutPipeline` (bounded wait,
index.js:3704-3708); pipeline launched with `capabilityFilter` excluding every LLM-heavy
stage (agent.js:823-824). This was the B2 fix for the LLM-hang close-out bug.

### 1.6 Safety boundaries on the autonomous path

- Autonomous dispatch **never traverses HTTP** — calls the shared handler in-process
  (index.js:4233-4235); the `__qaseInternalAutonomy` marker is a module-private field,
  not wire-populatable (index.js:2893-2905).
- Target SSRF guard re-validated at dispatch time (index.js:2920-2925 via
  validateTargetUrl) — autonomous revalidation cannot pivot to a blocked target.
- Autonomy cannot stop/finalize any mission but its own (index.js:3670).
- All HTTP surfaces remain token/HMAC gated; no auth bypass exists on the path.

---

## 2. What still REQUIRES human intervention

| Point | Classification | Evidence |
|---|---|---|
| Mission creation / authorization of budget | product design (external trigger) | POST /api/v1/missions (token/HMAC) |
| Target allow-listing | safety authorization (SSRF guard) | targetGuard LOCAL_ALLOWED_PORTS |
| Credentials for auth-gated targets | credential requirement | session.secretNames / vault |
| **Finding-level fix-validation** (`POST /api/v1/findings/:id/revalidate`) | **product design — NOT autonomously triggered** | phaseRouter.js:417-438; triggers are only `manual` / `integration` (index.js:1966); no code path from autonomyController reaches createRun | 
| Mission abort | safety authorization (scope `mission:stop`) | index.js:1864-1878 |
| Answering `awaiting_input` questions | product design (ESCALATE decision) | decisionEngine RULE 1 |

**Within a mission's lifetime, no human is required between iterations** — the
autonomy gate chains iterations by itself, bounded by the turn pool + iteration guard
(`maxIterations`, default via validationLoop DEFAULT_MAX_ITERATIONS) + no-improvement
convergence guard.

---

## 3. Remaining dead / unwired paths

| Item | Site | Note |
|---|---|---|
| `runAutonomyDecisionSync` / `autonomyGateSync` | autonomyController.js:180/267 | zero callers; index.js keeps its own inline copy |
| `decisionTraces.allDecisionTraces` | decisionTraces.js:139 | zero callers (intended for A/B differ, never wired) |
| `riskModel.buildCoverageReport` | riskModel.js:351 | zero callers |
| `findingEnrichment.enrichSessionFindings` | findingEnrichment.js:82 | test-only; not in production pipeline |
| `decision_engine` capability | capabilities.js:564-590 | record-keeping only, runs AFTER mission_finalize |
| dead imports in index.js | index.js:110 (`resolveAction`), 128 (`decisionEngineNs`) | imported, never used |
| dead read `session._autonomyDecision` | index.js:3810 | never assigned anywhere |
| **testContext/risk NOT consumed by decision layer** | decisionEngine.collectDecisionInput (478-578) reads findings/steps/appModel/pipeline — never `session.testContext` | risk signals reach only the PROMPT (prompt.js:26-39). The B2 wiring claim "testContext/risk → decision layer" is NOT true today. |
| **evidence payload empty at the gate** | index.js:3640 calls runAutonomyDecision({mission, session}) — `evidence={}` | quality/verdict inputs are null in production; rules depending on qualityScore/verdict degrade to finding/step heuristics |

---

## 4. C2 gap analysis — CONTINUE / INVESTIGATE / REPLAN / STOP

| C2 verb | Status today | Gap |
|---|---|---|
| **STOP** | ✅ four variants live, wired to finalization | none |
| **INVESTIGATE** | ◐ REVALIDATE covers it semantically (verify previous findings, knowledge conflicts) — prompt lists prior findings (validationLoop.js:505-521) | no explicit category/label; knowledge-conflict patterns not surfaced into the re-run prompt |
| **REPLAN** | ❌ does not exist. Insufficient-coverage + budget currently returns REVALIDATE whose prompt says "verify previous findings" — wrong focus when there are NO findings to verify; the fallback is a plain mission prompt (index.js:3046-3048) with no re-planned focus | no decision type, no changed-approach focus payload, no prompt section |
| **CONTINUE** | ❌ unreachable in production (only fires for running sessions; gate requires settled) | "settled with almost no activity + budget left → keep going (same approach)" has no path |

## 5. Known limitations (carried into C2)

1. Decision engine is fully deterministic — the "decision maker" is a rule cascade,
   not an LLM (by design; LLM-driven replanning is explicitly out of C2 scope).
2. Decision gate fires once per settled session per process run (`_autonomyDecisionAt`
   stamp) — restarts re-enter via finalizeMissionFromSession recovery (index.js:4092).
3. Traces record signal KEYS only — right for privacy, limits post-hoc debugging.
4. Mid-mission steering (while the SDK turn is streaming) does not exist; autonomy
   decides **between** iterations only.
5. Evidence payload to the gate is empty (§3) — quality/verdict-based rules are inert
   in production today.

**Phase 0 verdict:** the loop skeleton, budget invariant, trace pipeline, and safety
boundaries are LIVE and tested; the missing autonomy surface is the four-verb decision
vocabulary (CONTINUE/INVESTIGATE/REPLAN beyond STOP), the risk/testContext → decision
wiring, and the REPLAN focus → prompt → changed-execution path. These are exactly C2
Phases 2–3.
