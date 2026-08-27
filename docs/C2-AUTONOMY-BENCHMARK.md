# C2 — Autonomy Benchmark (Phase 6/7)

**IMPORTANT — measurement correction.** The `findings` columns recorded by the benchmark harness during the live runs were **wrong (0)**: the harness queried `/api/v2/findings?mission_id=…`, and iteration findings do not carry a `missionId` field, so the filter matched nothing. The harness was corrected mid-C2 to fall back to the authoritative mission document. The table below shows the **corrected counts** retrieved post-hoc from the mission documents.

## 12-turn runs (second pass)

| Target | Arm | Status | Findings (crit) | Turns | Stop |
|---|---|---|---|---|---|
| localhost:9901 | A-off | completed | 13 (0c, 2h, 11m) | 12/12 | budget_exhausted (legacy) |
| localhost:9901 | B-auto | completed | 13 (0c, 3h, 10m) | 12/12 | budget_exhausted (engine STOP_BUDGET) |
| localhost:9903 | A-off | failed | 17 (3c, 2h, 12m) | 12/12 | legacy verdict fail |
| localhost:9903 | B-auto | failed | 17 (3c, 2h, 12m) | 12/12 | **engine STOP_FAIL** |
| new.drytis.com | A-off | completed | 12 (0c, 1h, 10m) | 12/12 | approved (early settle) |
| new.drytis.com | B-auto | completed | 12 (0c, 0h, 11m) | 12/12 | engine STOP_BUDGET |

Adaptive proof (smoke, pool 12, 9902): **failed via engine STOP_FAIL on 18 findings (3 critical, 2 high, 13 medium)** — evidence-correct stop, no fabricated pass.

## 6-turn runs (first pass)

All arms ended STOP_BUDGET/STOP_FAIL with identical outcomes per target; the decision vocabulary observed live was {STOP_BUDGET, STOP_FAIL}.

## Reading the numbers honestly

- **Arm equivalence is expected** in the current single-iteration execution model: the decision gate fires at session settle. When iteration 1 uses the whole pool, both arms must stop; the engine chooses the labeled, traceable reason (STOP_BUDGET/STOP_FAIL) vs the legacy implicit one.
- **Where the engine adds value today:** (1) early-settling sessions (smoke, fast-critical, error) get evidence-correct verdicts immediately; (2) every terminal decision is recorded as a 13-field trace with budget request/grant columns; (3) STOP_FAIL fired only on real confirmed criticals — 0 fabricated verdicts across all runs.
- **False-positive pressure is visible** on new.drytis.com (marketing site classified as CRM → missing-feature noise, confidence 0.05–0.06). That is C3 (finding quality), not autonomy scope.

## Raw artifacts

- `.drytis/c2-benchmark-results.json` — as-recorded (zeros due to the measurement bug, annotated).
- Mission IDs (12-turn): 9901 A cf06db8e / B 837470ed; 9903 A e409d066 / B 4422369b; new.drytis A 319c62d2 / B 15c04fa3; adaptive 0f982540.
