# C2 — Production Autonomy Contract

**Build:** C2 · **Depends on:** B2 wiring (live), B1 budget invariant, B0 ceilings
**Locked objective:** prove QASE operates as a genuinely autonomous testing agent on
real applications, bounded and truthful. NOT a redesign — C2 completes the four-verb
decision vocabulary and wires the remaining signals into the live loop.

---

## 1. The autonomous decision cycle (contract form)

Every autonomous decision must be an instance of:

```
INPUT STATE → INFORMATION SELECTION → DECISION → ACTION → RESULT → EVALUATION → NEXT DECISION
```

Concrete mapping in QASE:

| Contract stage | QASE implementation | Where |
|---|---|---|
| INPUT STATE | settled session (findings, capturedSteps, pages, turnCount, appModel, pipeline summary) + mission envelope | collectDecisionInput (decisionEngine.js:478) |
| INFORMATION SELECTION | explicit signal extraction: finding/severity/duplicate counts, evidenceCompleteness, pagesExplored, step yield, knowledge agreement, risk assessment, budget remaining | collectDecisionInput + **C2: buildTestContext/risk merge (§4)** |
| DECISION | deterministic rule cascade over selected signals → one of CONTINUE / INVESTIGATE / REPLAN / REVALIDATE / ESCALATE / STOP_PASS / STOP_FAIL / STOP_BUDGET / STOP_BLOCKED | evaluatePolicy (decisionEngine.js:593) |
| ACTION | resolveAction mapping → wait / revalidate / replan / stop{pass,fail,budget,blocked,escalated} | validationLoop.js:378 |
| RESULT | budget authority answers ALLOWED/DENIED; granted → real dispatch (new iteration with changed focus); denied → truthful stop within budget | autonomyController.js:117-142 |
| EVALUATION | the next iteration's settle recomputes all signals; convergence/iteration guards evaluate improvement | analyzeConvergence, hasReachedIterationLimit |
| NEXT DECISION | the gate fires again on the next settled session; idempotency per session | autonomyController.js:95 |

## 2. Structured decision metadata (no chain-of-thought)

Every decision writes ONE trace record — 13 fields + ts (unchanged B2 schema, locked
with the operator):

`decision_id, mission_id, iteration, ts, state, signals_used (KEYS ONLY),
candidate_action, selected_action, reason, budget_before, budget_requested,
budget_granted, result, next_decision`

C2 additions (schema-compatible, no new fields):
- `candidate_action` / `selected_action` may now carry `INVESTIGATE` / `REPLAN`
  (values pass the ≤60-char sanitize; the allowlist of decision TYPES extends, the
  trace schema does not).
- `signals_used` gains keys from risk/testContext (e.g. `riskLevel`, `topRisks`,
  `hasAdaptiveGuidance`) — KEYS only, never values.
- `next_decision` gains `next_iteration_investigate` / `next_iteration_replan`.

NEVER recorded: raw model output, prompts, page content, credentials, secrets,
chain-of-thought.

## 3. The four verbs — decision semantics (C2 core)

All decisions are made from ACTUAL mission/session/evidence state. No verb may be
hard-coded for all situations; each must be reachable by a distinct input state
(proven by tests in Phase 10):

| Verb | Fires when (state condition) | Effect on execution |
|---|---|---|
| **CONTINUE** | settled with near-zero evidence AND budget remaining AND no findings AND low page coverage — "keep going, same approach" | new iteration with the SAME mission prompt (mission not re-scoped) |
| **INVESTIGATE** | findings exist (esp. high/critical or duplicate-heavy) AND budget remaining — "verify what we found before broadening" | new iteration whose prompt lists prior findings to verify (existing buildRevalidationPrompt) — labeled INVESTIGATE in trace + iteration metadata |
| **REPLAN** | evidence thin / step yield poor / approach producing poor results AND budget remaining — "same target, changed approach" | new iteration whose prompt carries a REPLAN FOCUS: untested areas from appModel coverage, risk-ranked areas from testContext, broken/untested workflows from gap report — NOT a findings-verify prompt |
| **STOP** (×4) | sufficient evidence & pass / criticals or fail verdict / budget exhausted / blocked — unchanged B2 semantics | terminal finalization (existing) |

Differentiation contract (Phase 3 acceptance):
- 0 findings, 0 steps, budget left → CONTINUE (never INVESTIGATE/REPLAN — nothing to verify or replan from)
- findings exist, budget left → INVESTIGATE
- steps taken but pages stuck at 1–2 + low finding yield + budget left → REPLAN
- budget exhausted / sufficient coverage → STOP family

## 4. Information selection — wiring risk/testContext into the decision layer (C2 fix)

Baseline finding (C2-AUTONOMY-BASELINE.md §3): `buildTestContext`/riskModel output
reaches only the PROMPT, not the decision layer. C2 wires it WITHOUT changing the
engine's determinism:

1. `collectDecisionInput` gains `risk` (from `session.testContext.riskAssessment`:
   level, top risk areas) and `focusSignals` (pagesCovered vs appModel page count,
   untestedAreas, adaptiveGuidance presence).
2. `evaluatePolicy` REPLAN/CONTINUE rules consume these signals (still deterministic
   thresholds — same character as evidenceCompleteness < 0.50 today).
3. `resolveAction` maps REPLAN → `action: 'replan'` carrying a `focusPayload` built
   deterministically from appModel/testContext/gap report.
4. The dispatch (index.js revalidate begin-closure) accepts `focusPayload` and, when
   present, appends a "RE-PLAN FOCUS" section to the iteration prompt (untested areas,
   risk-ranked priorities) instead of the findings-verify section.

## 5. Budget safety — hard invariant (unchanged, re-proven)

The agent may REQUEST, never GRANT:
- `requested ≤ authorized` always: requests are for one iteration; the answerer
  (`turnsRemaining`) computes against the already-authorized envelope.
- `actual execution ≤ authorized ceiling`: pool debit at dispatch
  (index.js:3000-3011) + per-event abort (agent.js:567-588) + entry validation
  1–500 (index.js:1630/2370) + config clamp (config.js:277).
- NO autonomy code path writes session.maxTurns or mission.context.maxTurns or
  maxIterations — enforced by source-regex regression test (extended in C2 to the
  new code).
- Ceiling stays external: the absolute 500 clamp and operator defaults (120) remain
  in config/index.js, outside the agent.

## 6. Deterministic close-out — LLM independence (unchanged contract, re-proven)

Finding lifecycle: detected → evidence collected → evaluated (scoreFindingQuality) →
autonomy decision (INVESTIGATE/REVALIDATE/REPLAN/STOP) → finding status updated via
finalize path → mission continues/stops. The deterministic close-out must complete
with ZERO model calls; an unavailable/slow/failing LLM must not block finding
persistence, trace persistence, or truthful finalization. Evidence requirements are
not weakened (findings still require observed evidence; gaps still require heuristic
signals).

## 7. Failure safety (Phase 9 contract)

Under LLM timeout / LLM error / malformed decision / empty decision / missing context /
no findings / duplicate findings / evidence unavailable / browser failure / budget
nearly exhausted / budget exhausted, the system must:
- fail SAFE: truthful state, no infinite loop, no budget self-increase, no fabricated
  findings/evidence, no phantom action claims, no silent provider switch, no security
  bypass;
- unknown decision types fail-OPEN to the legacy finalization path (existing
  autonomyController.js:102-105 contract — preserve);
- every denial produces a truthful trace (`denied_and_stopped`) — never a silent no-op.

## 8. Human intervention contract (Phase 8)

Classified as: product design (mission creation, budget authorization) · safety
authorization (target allow-list, abort) · credential requirement · TRUE autonomy
failure. C2 target: within a mission's authorized lifetime, ZERO true autonomy
failures — the agent independently decides CONTINUE/INVESTIGATE/REPLAN/STOP at every
gate. Legitimate human boundaries are NOT removed.

## 9. Acceptance criteria (Phase 12 gate)

C2 is COMPLETE only if all of the following are demonstrated with evidence:
1. A real application given to QASE → mission created via integration API.
2. QASE inspects state (signals present in traces).
3. QASE autonomously selects the next action — all four verbs reachable, each driven
   by distinct state (unit-provable) and observed live at least once across the
   benchmark targets.
4. The decision changes actual execution (CONTINUE/INVESTIGATE/REPLAN → different
   iteration prompts; STOP → different terminal outcome; budget denial → truthful stop).
5. Trace evidence for every decision (13 fields, keys-only signals).
6. Result evaluation → next decision (multi-iteration chains observed).
7. CONTINUE / INVESTIGATE / REPLAN / STOP all observed in live runs.
8. Deterministic close-out completes without LLM (forced-failure test).
9. Never exceeds authorized ceiling (regression + live: Σturns ≤ maxTurns on every run).
10. Truthful evidence/results (no fabricated findings under failure injection).
11. Works on >1 target (≥2 local benchmark apps + new.drytis.com).
12. B1/B2 gates remain green (b1 canaries, b2 suites, regression set).

## 10. Out of scope (locked)

No C3, no BrowserStack credential work, no LLM restructuring, no adaptive
turn-governor architecture, no new API endpoints (unless a documented blocker
requires the smallest possible change), no UI redesign, no infra changes.
