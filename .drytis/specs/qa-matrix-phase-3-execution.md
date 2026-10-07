# Phase 3 — Configuration-set execution: queue, concurrency, cancel, retry, statuses

## Goal
Route Start QA with a configuration set through the EXISTING server-side matrix orchestrator
(`POST /api/matrix-runs`) instead of the client-side per-engine fan-out. Every selected
configuration gets a real run (or an honest blocked/unavailable record) — no silent reduction
to representative devices or engines. Add the missing orchestration semantics: Queued status,
cancellation, retries.

## Files to change
- `server/matrixService.js` — extend `MATRIX_ITEM_STATUSES` with `QUEUED`, `SKIPPED`,
  `CANCELLED` (PENDING retained for created-not-yet-queued); add run-level `cancelled`
  status; backward-compatible serialization (unknown old statuses tolerated on read).
- `server/matrixOrchestrator.js` —
  - Items enter `QUEUED` when the run starts; worker pool pulls QUEUED items
    (concurrency unchanged: `QASE_MATRIX_PARALLEL`, default 1).
  - **Cancellation**: `cancelRun()` — flips remaining QUEUED items to `CANCELLED`,
    run status `cancelled`; running item finishes its current turn (or is aborted via
    existing session abort path) and records `CANCELLED` if aborted, `PASSED`/`FAILED`
    otherwise. Also `cancelItem()` for a single queued item.
  - **Retries**: `retryItem(itemId)` re-queues a `FAILED`/`ERROR`/`BLOCKED`/`CANCELLED`
    item (bounded: max 2 retries per item, recorded); retry clears previous verdict.
- `server/matrixApi.js` — new routes: `POST /api/matrix-runs/:id/cancel`,
  `POST /api/matrix-runs/:id/items/:itemId/retry` (+ tests).
- `server/app.js` — matrix wiring hook already creates sessions per item
  (`engineForMatrixItem` derives engine from browserCode — REAL branded binaries still
  win via `browserSupportResolution`); ensure the QA start path can create a matrix run:
  extend the QA launcher start to accept `{ targetUrl, kickoffText, selectedTests,
  securityAuthorization, configurationEnvIds[] }` — new endpoint
  `POST /api/qa-matrix-runs` (thin wrapper: resolves configurations from catalog,
  builds items, delegates to matrix service + orchestrator, returns matrixRunId).
- `public/app.js` — Start QA submit: replaces the engine loop; POSTs the config set,
  receives matrixRunId, switches the live view to the run's first active session
  (existing batch/live-switch mechanics), tracks progress via SSE `matrix_item` events
  (add the missing frontend consumer) + polling fallback.

## Honesty invariants (must hold)
- Chromium execution is never reported as Chrome/Brave/Opera/Edge/DDG testing: item records
  carry `runtimeFacts.launchedEngineId` + `brandedBinary`; a branded binary must be
  launch-verified to claim the brand (existing `browserSupportResolution` contract).
- WebKit execution is labeled engine-equivalent, never "Safari" (existing webkitNote logic).
- Missing provider/credential ⇒ item `BLOCKED` with "Not configured"/"Unavailable" reason;
  never silently substitutes emulation for a requested physical device.
- Every selected configuration receives a terminal status; none silently dropped.

## Acceptance criteria
- [ ] Starting QA with N selected configurations creates one matrix run with N items; the
      summary shows "N planned configurations" before start.
- [ ] Items progress Pending → Queued → Running → Passed/Failed/Blocked/Skipped/Cancelled,
      visible live in the UI.
- [ ] Cancelling the run stops scheduling; remaining queued items read Cancelled.
- [ ] A failed item can be retried (bounded), and the retry produces a fresh result.
- [ ] Every configuration's result records the actual device, OS, browser, version and
      execution type returned by the runner (runtimeFacts).
- [ ] An unconfigured provider produces a visible "Not configured" / Blocked result —
      never an emulated substitute.

## Tests
- Orchestrator unit tests: queue transition, cancel (queued→cancelled, running→terminal),
  retry bound, honest-status guard (no pass without execution).
- API tests for the two new routes + `POST /api/qa-matrix-runs` (validation, unknown envId → 422).
- SSE event contract test (matrix_item carries item status changes).

## Edge cases
- Server restart mid-run: existing `resumeRecovery` sweeps to interrupted; cancelled-run
  recovery keeps cancelled state (not flipped to error).
- Retry after catalog changed (env retired) → honest BLOCKED, not crash.
- Empty configuration array → 400.
