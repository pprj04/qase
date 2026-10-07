# Ticket #14937 round-2 recheck (2026-10-06)

Scope: (1) cancelledRuns.delete fix, (2) configurationEnvIds cap, (3) new orchestrator tests.

## Verified
- **Fix 1 — cancel marker**: matrixOrchestrator.js no longer deletes from `cancelledRuns` in `executeRun`; the only remaining `cancelledRuns.delete` is in `retryItem` (line 142) to allow restart of a cancelled run. The post-drain `cancelledRuns.has` check (line 175) is now live. `drainQueued` worker checks the marker before each claim (line 199). `matrixService.cancel` flips QUEUED/PENDING→CANCELLED with reason + finishedAt, run→cancelled. Orchestrator test 11 covers QUEUED→CANCELLED + worker stop + run cancelled.
- **Fix 2 — cap (static only)**: server/app.js:879-890, MAX_MATRIX_CONFIGURATIONS=2000, >2000 → 422 with honest message. LIVE CHECK WAS NOT POSSIBLE: running server pid 69 (started 22:32) predates the fixed app.js (mtime 22:34) — a 2001-id POST returned 201 with a 2001-item run (`matrix-muxa4jhi-b90b3b35`, all honest BLOCKED "no longer in the catalog"). Server needs restart to load the cap; do NOT interpret the 201 as the cap failing — the code is correct but unloaded.
- **Fix 3 — tests**: matrixOrchestrator.test.js now has **12** tests (handoff claimed 13 — off by one); test 11 = cancel, test 12 = retryItem (re-queue, retryCount 1→2, 3rd refused /retry/i, PASSED refused). All 12 pass. matrixService.test.js + matrixService.queued.test.js = 21/21 pass (queued file now exists, 5 tests).

## Outstanding from round-1 FAIL (still open)
- matrixApi.test.js (5 tests) still has NO tests for POST /api/matrix-runs/:id/cancel or /:id/retry, and no SSE matrix_item contract test. Only the orchestrator half of the missing-test FAIL was resolved.

## New WARNs
- Test runner hangs ~8 min after all 12 tests pass: cancel test deliberately leaves a session RUNNING ("First item hangs mid-run") → `waitForSession` polls until MAX_ITEM_MS=8min with POLL_INTERVAL_MS=2s. Test-design artifact, not a prod regression, but it makes the suite look wedged (this box also has documented PID-wedge history — use tap reporter + timeout when running).
- `cancelledRuns` markers are never deleted for runs that settle cancelled → unbounded Set growth per process lifetime (tiny, auth-gated; cosmetic).
- No automated test covers the 2000-config cap.
- matrixOrchestrator.js `MAX_ITEM_RETRIES` declared at line 397 (after retryItem usage) — hoisting makes it work.
