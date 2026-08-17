# Autonomous Fix Validation — Phase 18

Qase does **not** modify the application. Phase 18 closes the loop:

```
FINDING → ORIGINAL EVIDENCE → ORIGINAL REPRODUCTION → APPLICATION CHANGE
        → REVALIDATION → COMPARE BEFORE/AFTER → FIX STATUS
        → REGRESSION CHECK → KNOWLEDGE UPDATE → HUMAN REVIEW / APPROVAL
```

## 1. What was built (genuine gaps only)

The Phase 18 audit (`docs/PHASE_18_CURRENT_STATE.md`) found NO existing fix
validation: no fix_status anywhere, the existing `POST /api/findings/:id/revalidate`
was enrichment-only, and `POST /api/v1/missions/:id/revalidate` was a full LLM
mission re-run (different instrument). Phase 18 added:

| Module | Role |
|---|---|
| `server/fixStatusEngine.js` (276 l.) | Pure deterministic status/confidence/sufficiency engine. No I/O, no LLM. |
| `server/fixValidation.js` (289 l.) | Store `.qase/fix-validations.json`, immutable finding snapshot, review machine, metrics. |
| `server/validationExecutor.js` (421 l.) | Async executor: builds replay test case from the finding's own steps, runs attempts, records BEFORE/attempt/regression evidence, targeted regression scan, environment deltas. |
| `knowledge.js` (extended) | `writeFixValidationKnowledge` — routes validated outcomes into the EXISTING knowledge system (new `fix_validation` type). No second memory. |
| `index.js` (wired) | v1 + legacy routes, idempotency, metrics, redaction; auth fixed on `PATCH /api/findings/:id/status` (now `requireApiToken`). |
| `public/bugs.js` + `styles.css` | Fix-validation panel: status, confidence, attempts, before/after blocks, regression result, [View Original][View Validation][Compare][Revalidate][Approve Closure]. |

## 2. Revalidation plan = the finding's own workflow

`buildValidationTestCase` converts the finding's recorded steps (string[]) into
replay steps (navigate / click text= / fill / wait) and generates assertions
from the finding itself:

- `url_contains` from the finding URL
- `no_console_errors`, `no_failed_requests`
- expected-behavior assertion from `expected` text where derivable

It never invents an unrelated new test — if a step can't be converted, the run
records the gap rather than silently substituting a different workflow.

## 3. Same-condition validation

Environment recorded and compared per run: url, viewport, browser, device,
os, testData, credentials, feature, state. Differences surface as
`environmentDeltas` and, when material, force `UNABLE_TO_VERIFY` rather than
a false verdict. BrowserStack configuration is preserved for runs that used it.

## 4. Targeted regression (risk-based, not whole-app)

`selectRegressionSet(finding)` orders candidates:

1. test cases already linked to the finding (`findingIds[]` join)
2. cases covering the same workflow
3. cases touching the same feature / neighboring workflows

Cap 6, budget 2 executed per run (`regressionBudget`), historical signal
(historical tests) consulted via the existing replay store. A regression only
marks the run REGRESSED when **verified** (test failed) — not on suspicion.

## 5. Execution model (async, non-blocking)

```
POST /api/v1/findings/:id/revalidate  ──► 202 { validationId, status: REQUESTED }
   │ Idempotency-Key: <key>   → duplicate returns SAME validationId (idempotent)
   └─ executor loop (setImmediate) picks up: REQUESTED → QUEUED → RUNNING
        attempts (QASE_FIX_VALIDATION_ATTEMPTS, default 2) + regression scan
      → COMPLETED { fixStatus, validationConfidence, comparison, evidence }
```

The API never blocks on the browser agent. Every run has a stable `fxv_*` id;
`GET /api/v1/findings/:id/validation` polls history (latest + all runs).

## 6. Deterministic Fix Status Engine

See `docs/FIX_STATUS_MODEL.md`. Highlights:

- decision order: env-mismatch → reproduced → inconclusive → expected-not-
  observed → mixed attempts → insufficient evidence → verified regression →
  VERIFIED_FIXED
- LLM can NEVER pick the final status (spec §7) — the engine is pure functions
- partial fix detection (`detectPartialFix`): primary expectation met while a
  related verified failure remains → `PARTIALLY_FIXED`
- `REGRESSED` beats `VERIFIED_FIXED` — never report fixed when a verified
  regression exists (spec §12)
- attempts aggregation incl. `reproductionRate`; intermittent → UNABLE_TO_VERIFY

## 7. Validation confidence (new measurement)

Independent of the finding's Phase 16 confidence — computed from validation
evidence only (same repro path, same environment, repeated success, expected
reached, original absent, console/network clean, related workflows green,
evidence complete). See FIX_STATUS_MODEL.md §5.

## 8. Human review & lifecycle

`AUTO_VALIDATED` (high-confidence VERIFIED_FIXED) / `REVIEW_REQUIRED` /
`APPROVED` / `REJECTED` / `REOPENED`, with reviewer, timestamp, decision,
comment, and a full trail. Approve → finding `RESOLVED` via existing Phase 16
lifecycle transitions; REOPENED restores investigation (existing
`RESOLVED→REOPENED` transition reused). Approval applies to lifecycle closure
only — evidence is never rewritten.

## 9. APIs

| Endpoint | Notes |
|---|---|
| `POST /api/findings/:id/validate-fix` | legacy alias (auth'd) |
| `POST /api/v1/findings/:id/revalidate` | Idempotency-Key; 409 if active run; 202 |
| `GET /api/v1/findings/:id/validation` | history + latest run (redacted) |
| `GET /api/v1/findings/:id/comparison` | structured before/after + verdicts |
| `POST /api/v1/findings/:id/approve` | review state APPROVED + finding RESOLVED |
| `POST /api/v1/findings/:id/reopen` | review REOPENED + finding reopened |

JWT auth (`requireIntegrationAuth`) + token (`requireApiToken`), workspace
isolation, and the existing Drytis contract are preserved. Phase 16
integration APIs unchanged (verified by integration test T13). The
pre-existing auth hole on `PATCH /api/findings/:id/status` was closed.

## 10. Verification summary

- **Unit** 38/38 — status classification, confidence, partial fix, regression,
  sufficiency, attempts aggregation, knowledge gate.
- **Integration (API)** 13/13 — 401/404 gates, lifecycle REQUESTED→COMPLETED,
  idempotency, 409 active-run guard, comparison, approve/reopen, metrics
  parity, Phase 16 back-compat.
- **E2E** 10/10 — incl. T10 mutation-survival, refresh persistence, REGRESSED
  precedence.
- **Real lifecycle runs** (scripts/phase18-lifecycle-run.mjs): Scenario A
  (detect → STILL_BROKEN → real fix → VERIFIED_FIXED → approved/resolved) and
  Scenario B (fix + broken bulk import → REGRESSED, reopened) — both PASS.
- **Benchmark** 10/10 scenarios; fix verification accuracy 100% (≥90),
  false-fixed rate 0% (≤5), regression detection 100% (≥90), evidence
  completeness 100% (≥95). Results: `.drytis/phase18-benchmark-results.json`.
- **Performance** — validation wall-clock ≈ 6s per run (2 attempts + targeted
  regression ≤ 6 cases); startup latency (API → REQUESTED) < 50ms; evidence
  capture adds no separate pass (recorded during attempts).

## 11. Knowledge update safety

Only high-confidence validated outcomes are stored (VERIFIED_FIXED →
fix-validation knowledge; STILL_BROKEN → failure knowledge; everything else —
UNABLE_TO_VERIFY, PARTIALLY_FIXED, REGRESSED, low confidence — is NEVER
stored as confirmed fact). Stored items carry: original failure, repro path,
validation path, fix result, regression result, feature/workflow, environment,
evidence refs, final status.
