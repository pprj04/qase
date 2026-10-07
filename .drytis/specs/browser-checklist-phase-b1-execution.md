# Phase B1 — Start QA wired to matrix execution

## Goal
Make the existing Start QA action actually execute every selected browser configuration. Today
`public/app.js:5600–5635` runs `selectedEnvIds.slice(0, 1)` through `POST /api/sessions` with a
hardcoded `engine: 'chromium'` — every selected configuration after the first is silently
dropped. Build the spec'd-but-unbuilt `POST /api/qa-matrix-runs` path (see
`qa-matrix-phase-3-execution.md`) and unify the disconnected TEST ON block with the matrix
selection. One browser's failure must never determine another's result (independent items).

## Work
- `server/matrixService.js`: add `QUEUED` item status (PENDING stays for created-not-started);
  run-level `cancelled`. Backward-compatible reads.
- `server/matrixOrchestrator.js`: items → QUEUED at start; worker pool pulls QUEUED
  (concurrency `QASE_MATRIX_PARALLEL`, default 1, unchanged); `cancelRun()` /
  `cancelItem()`; `retryItem()` bounded at 2 retries, clears previous verdict.
- `server/matrixApi.js` / `server/app.js`: `POST /api/qa-matrix-runs` accepting
  `{ targetUrl, kickoffText, selectedTests, securityAuthorization, configurationEnvIds[] }`
  → creates matrix run, returns matrixRunId; plus
  `POST /api/matrix-runs/:id/cancel`, `POST /api/matrix-runs/:id/items/:id/retry`.
- `public/app.js` submit handler: POST the full selected configuration set (no slicing);
  run view switches to the run's first active session; progress via SSE `matrix_item`
  (add the missing frontend consumer) + polling fallback. Honor `scopeSelection` and the
  same kickoff workflow per item.
- Unify selection: the TEST ON block (`index.html:746–768`, `selectedEnvironmentForRun()`)
  becomes derived from the matrix selection (first selected config) instead of a competing
  store; keep its visible UI unchanged.
- Honest invariants (already enforced, must not regress): branded claims only from
  launch-verified binaries; WebKit never labeled Safari; missing provider → BLOCKED
  "Not configured"; every selected config gets a terminal status.

## Acceptance criteria (true in running app)
- [ ] Starting QA with N selected configurations creates one matrix run with N items — none silently dropped.
- [ ] Items progress PENDING → QUEUED → RUNNING → terminal (PASSED/FAILED/BLOCKED/ERROR/NOT_RUN…), visible live.
- [ ] A failing browser does not change any other browser's outcome or scheduling.
- [ ] Cancelling stops scheduling; remaining queued items terminal Cancelled/NOT_RUN.
- [ ] Retry of a failed item produces a fresh result (bounded).
- [ ] Unconfigured providers produce visible "Not configured"/Blocked, never emulation substitution.

## Tests
- Orchestrator: queue transitions, independence (item failure doesn't poison siblings), cancel, retry bound, honest-pass guard (`matrixService.js:350–368` unchanged and covered).
- API: qa-matrix-runs validation (unknown envId → 422, empty set → 400), cancel/retry routes, SSE item contract.

## Edge cases
- Restart mid-run (resumeRecovery), retry after env retired → BLOCKED, single-config run still works (backward compat with TEST ON path).
