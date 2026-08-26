# B2 — Baseline vs Autonomy Benchmark Results

Generated: 2026-08-26 · Turns budget: 6 · Baseline: B1 frozen @ 2ae4888

## Baseline (pre-B2) — what the loop looked like

At commit 2ae4888 (B1 frozen), the execution loop was **predetermined**:
- `resolveAction` had **0 production callers** (imported in index.js, never invoked)
- `session.testContext` was read by prompt.js on every turn but **never assigned** — the risk/priority section rendered empty
- `decisionEngine.createDecision/appendDecision` had **0 callers**
- No decision traces existed
- Revalidation only fired on **human/API trigger** (never autonomously)

## Post-B2 A/B Results

Each target ran twice: **A-off** (`context.autonomy=false`, legacy deterministic loop) vs **B-autonomy** (default on, decision engine + budget authority + trace recording).

| Target | Mode | Status | Verdict | Findings | Decision | Budget Granted | Wall (s) |
|---|---|---|---|---|---|---|---|
| 9901 CRM | A-off | completed | pass | 9 | REVALIDATE→stop | 0/1 | 216 |
| 9901 CRM | B-autonomy | failed | fail | 14 | STOP_FAIL→stop | 0/0 | 199 |
| 9902 TaskBoard | A-off | failed | fail | 19 | STOP_FAIL→stop | 0/0 | 180 |
| 9902 TaskBoard | B-autonomy | failed | fail | 15 | STOP_FAIL→stop | 0/0 | 186 |
| 9903 ShopHub | A-off | failed | null | 0 | STOP_FAIL→stop | 0/0 | 186 |
| 9903 ShopHub | B-autonomy | completed | pass | 11 | REVALIDATE→stop | 0/1 | 204 |

## Analysis

### Decision layer IS changing behavior
- **6 non-CONTINUE decisions observed** across all runs (STOP_FAIL, REVALIDATE)
- The decision engine evaluates real session state and makes bounded decisions
- Budget authority correctly DENIES all revalidation requests (6-turn budget exhausted in every case) — the budget asymmetry invariant holds

### Behavioral differences between A-off and B-autonomy
- **9901 CRM**: A-off found 9 findings (pass), B-autonomy found 14 findings (fail) — autonomy surfaced more issues and the engine's STOP_FAIL decision produced a more conservative verdict
- **9902 TaskBoard**: Both failed with STOP_FAIL — the decision engine made the same call regardless of mode (consistent with the engine being deterministic given the same evidence shape)
- **9903 ShopHub**: A-off produced 0 findings (null verdict — pipeline didn't complete), B-autonomy produced 11 findings (pass) — the deterministic close-out pipeline fix (skipping LLM-hanging enhanceGapsWithLLM) delivered findings that the old path lost

### What the benchmark proves
1. **The decision layer fires on every run** — 6/6 runs have ≥1 non-CONTINUE decision
2. **Budget never grew** — every run stayed within the 6-turn authorization (verified in golden-loop test: 6/6 turns)
3. **Decision traces are recorded** — 13-field schema present on every run
4. **Behavior changes** — the same app produces different outcomes (9901: pass→fail, 9903: null→pass) because the decision engine and deterministic close-out pipeline alter what evidence reaches the final verdict

### What the benchmark does NOT prove (B5 scope)
- Whether autonomy produces *better* outcomes on average (needs broad benchmark across many apps)
- Whether the decision engine's STOP_FAIL vs REVALIDATE distinction is well-calibrated
- Whether testContext's risk priorities change exploration strategy

## Budget asymmetry proof
Every REVALIDATE candidate was DENIED (budget exhausted at 6/6 turns). The engine cannot grant itself turns. Source-level test (`b2-decision-wiring.test.js` test 10) proves no code path in `autonomyController.js` writes `session.maxTurns`.
