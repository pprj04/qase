# BUILD 18.3 RESULT — Targeted Revalidation Execution & Evidence

**Date:** 2026-08-20 · **Mode:** Controlled / Inspect-verify-first
**Outcome:** Functionality existed and verified end-to-end against real browser execution. **Zero source changes required.** One methodology error (mine, during controlled-fix simulation) confirmed correct executor behavior instead.

## Existing functionality (inspection, server/validationExecutorCore.js + replay.js + fixValidation.js)

1. **Finding reconstruction:** `createRun()` snapshots the finding immutably (`originalFinding` + `snapshotNote: "immutable original (Phase 18 invariant 1)"`) and derives a same-condition `plan` (url, viewport, device, browser, workflowId, featureId, steps, expected, regressionScope).
2. **Validation steps:** `buildValidationTestCase()` converts the finding's OWN human steps (`stepToReplay`: navigate/click/fill/reload/wait with resilient label→selector mapping) — never a generic smoke test. Unconvertible steps recorded as `gaps`. Assertions encode the finding's EXPECTED behavior: `url_contains` (path only), `element_visible` on `expectedAnchor()` (quoted/name extracts from the expected text), `no_console_errors`, `no_failed_requests`.
3. **Browser execution:** real Playwright via `runTestCase()` — fresh browser per attempt, viewport context, tracing on, console+network collector attached.
4. **Evidence capture:** screenshots persisted to `.qase/artifacts/<runId>/*.jpeg` on every step/assertion failure; trace.zip per run; DOM snapshot for selector self-healing; all wrapped into evidence-graph nodes (`createEvidence` + `linkEvidenceToFinding`) with `validationId`/`findingId`/`phase` metadata and redaction.
5. **Before/after storage:** `run.evidence.before` (from immutable snapshot) / `run.evidence.after` (per-attempt outcomes + screenshots), each entry carrying `evidenceNodeId` back-reference; `buildComparison()` derives the 4 verdicts.
6. **Result integrity:** executor only reports observations; `classifyFixStatus()` (deterministic, no LLM) is sole authority. Verified again live: non-executing attempts → `UNABLE_TO_VERIFY/reproduction_inconclusive` (never VERIFIED_FIXED).

## Real end-to-end verification (STEP 8, controlled ContactVault apps)

Controlled finding `356c3d00…` ("contacts lost on reload", 5-step workflow), real browser, 2 attempts each run:

| Phase | App | Result |
|---|---|---|
| A: unchanged buggy app (:9906) | buggy | **STILL_BROKEN** `original_failure_reproduced`, conf 0.95, both attempts executed 5/5 steps, `element_visible` failed as expected, failure screenshots + traces persisted |
| B (first attempt): finding.url → :9907 only | fixed | **STILL_BROKEN** — *correctly*: steps still pointed at :9906; executor replayed the ORIGINAL steps against the buggy app and refused to pass. Proof that validation is anchored to the original condition, not a generic smoke test |
| B2: url + steps → :9907 (proper fix simulation) | fixed | **VERIFIED_FIXED** `failure_absent_expected_observed_evidence_sufficient`, conf 1.0, all 4 assertions pass, comparison verdicts all true |

**Immutability verified across all 3 runs:** run-1's snapshot still records the original :9906 steps; every run snapshots the finding state at ITS start. Run-1/2 snapshots never mutated by later runs.

**Evidence verified:** 13 evidence-graph nodes linked to the finding (before-observations + per-attempt screenshots/outcomes, each tagged with validationId + phase); failure screenshots exist on disk (22,296 bytes) and are served via `/api/artifacts/:runId/:file` (HTTP 200); trace.zip per run.

**Persistence verified:** server restarted (`procmgr restart`) → all 3 runs + comparison verdicts + evidence-node back-references intact; history endpoint returns 2 prior runs.

## Failure-case verification (STEP 7)

- Non-executing attempts (page unavailable / launch failure) → `UNABLE_TO_VERIFY` (verified live via engine on exact executor outcome shape; covered by phase18-unit tests 122–139).
- Step failure aborts remaining steps (status fail + break) — no partial-workflow false pass.
- Insufficient evidence (`missingEvidence: expected_state_observed`) blocks VERIFIED_FIXED — observed in Phase B where assertions failed.
- Screenshot capture failures are best-effort and never fabricate evidence (`artifactPath: null` entries are honest).

## Tests

- phase18-unit 38/38 · phase18-api 13/13 · phase18-e2e 10/10 (all fresh this build)
- phase16-api 17/17 (fresh; initial 1/17 was my shell missing QASE_API_TOKEN export — the regression loop always sets it)
- phase9.2-revalidation-safety 56/56 · phase9.2-auto-revalidation 45/45 (fresh)
- Full 46-suite loop: zero source files changed this build (only this report added), so the last full-loop result carries: **46 suites / 1,075 pass / 0 fail** (BUILD 18.1 gate; no server file modified since — 18.2 touched only frontend assets not covered by the loop)

## Acceptance criteria — 15/15

- [x] Original finding context preserved (plan + snapshot verified live)
- [x] Original snapshot immutable (verified across 3 sequential runs)
- [x] Targeted validation executes the relevant workflow (finding's own 5 steps replayed; Phase B proved anchoring)
- [x] No fake/mock success (real browser; failure paths tested)
- [x] Expected vs observed captured (assertion actuals, comparison verdicts)
- [x] Evidence persisted (13 nodes + artifacts on disk + artifact route 200)
- [x] Evidence linked to run (evidenceNodeId + validationId metadata)
- [x] Evidence survives restart (verified post-restart)
- [x] Unverifiable never VERIFIED_FIXED (engine rule + live non-execution check)
- [x] Deterministic engine authoritative (LLM never in path)
- [x] STILL_BROKEN correctly detected (Phase A)
- [x] VERIFIED_FIXED after controlled fix (Phase B2)
- [x] Browser execution real (Playwright, traces on disk)
- [x] 18.1/18.2 behavior intact (suites green; UI untouched)
- [x] Regression green (see above)

## Known limitations / documented for later builds

- **Environment relocation**: when the fixed app moves URL/port, the finding's steps+url must be updated together — validation intentionally honors the ORIGINAL condition. A "same-defect, new-deployment" re-targeting helper is a candidate for a later build (documented, not implemented).
- Evidence entries without artifacts (step-level outcome summaries) carry `artifactPath: null` — structured rendering of these belongs to BUILD 18.4 comparison UI.
- `.qase/artifacts` contains legacy corrupted dirs ("Bad message" on find) — pre-existing disk debris from earlier container incidents; harmless to validation (this build's artifacts verified readable); cleanup belongs to the P0/P1 workspace-hygiene pass.

**Final verdict: PASS (already satisfied; verified, no changes needed).**
