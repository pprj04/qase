# B2 — Autonomous Control Loop (SPEC)

Parent baseline: B0 @ 0525ba7, B1 @ 2ae4888 (frozen). B2 = wiring, NOT architecture redesign.

## Goal
Make the AI actually steer execution: given application state, QASE selects the next
action from evidence (continue / investigate deeper / re-plan / stop / declare
finding), executes it, records an auditable decision trace, and evaluates the result —
without ever extending its own budget.

## Core invariant (HARD RULE)
Autonomy gets the steering wheel, NOT the fuel pump.
- resolveAction may REQUEST more turns; only the externally-set budget authority
  (session.maxTurns, default 120, ceiling 500) grants execution. NEVER grant.
- The decision layer can cause work to STOP earlier; it can NEVER increase budget.
- B1 W6 turn accounting (assistant_turn_start counting + independent backstop
  abort) must remain untouched and provably green after B2.

## Baseline snapshot (Phase 0, captured 2026-08-24 @ HEAD 2ae4888)
- Production gate: B1 gate = all b1-* suites green + golden flow 14/14; last full
  `run-tests.mjs gate` result: 3 legacy suites failing at that time
  (phase10-visual-regression-v2, phase11a-findings-store, phase14-multi-viewport),
  core mode all-green (incl. phase17-e2e after subscription pruning).
- resolveAction production callers: 0 (imported in index.js:110, never invoked).
- testContext: consumed by prompt.js buildQaContext + mutated by qaTools.js
  reassessRiskWithFindings, but NO builder ever assigns session.testContext → the
  per-turn "operating brief" risk/urgency section renders empty in every live run.
- riskModel consumers: reassessRiskWithFindings only. assessRisk, formatRiskForPrompt,
  buildCoverageReport = 0 callers.
- enrichment: findingEnrichment used in phaseRouter only (post-hoc), never feeds
  agent prompts.
- appUnderstanding/appModel: feeds mission summary bar only.
- decisionEngine: createDecision/appendDecision = 0 callers; history cap 100.
- Human-only revalidation path: revalidateMissionByIdHandler (index.js:2805) with
  guards already-running 409 / no-target 400 / iteration limit 409 / no-improvement 409.

## Workstreams

### W1 — testContext builder (server/autonomyContext.js — NEW)
- buildTestContext(session, mission, appUnderstanding) → assigns
  session.testContext = { riskAssessment, adaptiveGuidance, urgencyNote,
  coverageGaps: [], priorFindings: [] } before first agent turn.
- Uses riskModel.assessRisk + formatRiskForPrompt + appUnderstanding coverage.
- Called from startMissionExecution BEFORE runTurn begins (both call sites).
- Deterministic unit tests; NO LLM in the builder itself.

### W2 — Live decision point (server/validationLoop.js, index.js)
- After each agent phase completes (post-turn observe step), call
  decisionEngine + resolveAction(decisionType, mission) with the real mission state.
- Selected action dispatches: CONTINUE (no-op), INVESTIGATE (inject a focused
  follow-up prompt for next turn), REVALIDATE (guarded auto-revalidate — SAME guards
  as the human path: already-running 409, iteration limit 409, no-improvement 409),
  STOP (early-stop with reason), ESCALATE (record + terminal state for human).
- Budget check BEFORE dispatch: budgetGranted = turns remaining from the EXTERNAL
  session.maxTurns. A decision that requires more turns than remain → DENIED,
  downgraded to STOP. No code path may write session.maxTurns from the decision layer.
- Old behavior preserved when resolveAction returns CONTINUE (no decision → same loop).
- Escalation/ESCALATE + TERMINAL never auto-runs anything new.

### W3 — Decision traces (server/decisionTraces.js — NEW)
- Structured, auditable, secret-free. Persist per mission via existing P4.4
  persistence (registerStoreFlush / atomicWrite to .qase/decision-traces.json,
  capped: last 50 missions × 100 decisions).
- 13-field schema (user-locked): decision_id, mission_id, iteration, state/context
  used, signals used, candidate action, selected action, reason/category,
  budget_before, budget_requested, budget_granted, result, next decision.
- NO raw chain-of-thought, NO prompts, NO secrets, NO page content — only
  structured metadata. Masked exactly like findings are.

### W4 — Benchmark evidence (scripts/b2-benchmark.mjs — NEW)
- Targets: 9901 (CRM), 9902 (TaskBoard), 9903 (ShopHub) + new.drytis.com.
- For each: run OLD loop (decisions off — env QASE_AUTONOMY=off) vs NEW loop
  (QASE_AUTONOMY=on). Capture: State → Information used → Candidate actions →
  Selected action → Safety/budget decision → Execution → Result → Next decision.
- Metrics: decisions count, CONTINUE vs non-CONTINUE distribution, turns used,
  findings found, budget denials, early stops with reason.
- Output .drytis/b2-benchmark-results.json + docs/B2-BASELINE-VS-AUTONOMY.md.
- This is a THIN benchmark (B5 does the broad one). It must show the decision
  layer CHANGES behavior on real apps (non-CONTINUE decisions exist and are sane),
  not that outcomes are identical.

### W5 — Regression + gate
- All existing suites must stay green (b1-*, b0-*, phase*, contract, m1-p4.4).
- b1-start-path-turn-budget 1/1 and m1-p4.4-persistence 28/28 are canaries.
- New: tests-real/b2-decision-wiring.test.js (unit: builder, dispatch, budget
  denial, trace schema, no-CoT/no-secret in trace), tests-real/b2-golden-loop.test.js
  (integration: mission on 9901 with autonomy on; verify trace exists, budget never
  grew, loop terminated, findings retrievable via /api/v1/integration).
- QASE_AUTONOMY default: on (new behavior default), env can disable (off) for A/B.

## Out of scope (STOP rule)
- No B3 governor/model routing. No turn-granting. No UI redesign. No Playwright/
  BrowserStack/SSF/infra/DB changes. No learning/priors (B6). No new dependencies.
- Do not reopen Phase 18 fix validation. Do not touch B0/B1 files except where the
  loop integration strictly requires (index.js, agent.js call sites, prompt inputs).

## Acceptance (user-locked wording)
Given application state X, QASE identifies the relevant information, makes a bounded
decision, executes the selected action, records the structured decision trace,
evaluates the result, and either continues/re-plans/stops — without exceeding the
mission's already-authorized budget.

Proof: B2 acceptance test = tests-real/b2-golden-loop.test.js PASS + benchmark
diff showing ≥1 sane non-CONTINUE decision per benchmark app + canaries green.
