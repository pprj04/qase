# Review — #14937 Phase 3 configuration-set execution (2026-10-06)

Verdict: PASS overall with WARNs; one FAIL on spec-mandated tests.

Verified: launcher mode in matrixService.create pins exact envIds (no version swap), vanished envId → honest BLOCKED "no longer in the catalog" (live-confirmed 201 with BLOCKED item), DDG → NOT_SUPPORTED, empty array → 400 (live). Orchestrator: PENDING→QUEUED→worker pool→terminal; cancel() flips QUEUED+PENDING→CANCELLED, run 'cancelled' (kept across restarts in resumeRecovery); retryItem bounded MAX_ITEM_RETRIES=2, clears verdict, re-queues. updateItem guard: PASSED/FAILED require sessionId (unit tested). POST /api/qa-matrix-runs: auth 401 + CSRF 403 verified live; express.json 1MB cap.

Gaps (not fixed, per policy):
1. FAIL (spec Tests section): NO tests for cancel, retryItem, QUEUED transition, or SSE matrix_item contract. matrixOrchestrator.test.js has 10 tests (handoff claimed 14); matrixApi.test.js has 5 — none touch /cancel or /retry; matrixService.queued.test.js does NOT exist despite handoff listing it.
2. WARN: no frontend consumer for cancel/retry routes and no per-item status UI — public/app.js only polls GET /matrix-runs/:id (waitForFirstMatrixSession) for the FIRST running session. SSE matrix_item consumer from spec not implemented (comment says SSE endpoint is session-scoped, 404s for matrix ids) — polling only.
3. WARN DoS: no count cap on configurationEnvIds (environments patch endpoint caps at 1000, this doesn't). 1MB body → ~31k ids; default launcher selection is 37,244 — one Start click = 37k-item run, ~55MB synchronous state-file write, weeks of sequential execution. Auth-gated so self-DoS only.
4. Minor: retry of a vanished-env BLOCKED item re-queues; executeItem re-gates on resolveBrowserSupport('unknown','unknown') → honest NOT_SUPPORTED (not BLOCKED, not a crash) — acceptable.
5. Minor: executeRun does cancelledRuns.delete() before checking cancelledRuns.has() (matrixOrchestrator.js:172-176) — dead condition, but finalRun.status==='cancelled' fallback catches it.
6. Live evidence run matrix-mux672gl-984146c9 (from earlier session): 2 items, Safari honest BLOCKED + Chrome executed with artifacts — could NOT be re-fetched this session (box hit PID/fork exhaustion mid-review; see incident-pid-exhaustion-zombies).

Env note: box suffered severe fork/PID exhaustion during this review — several grep/bash calls failed with "resource temporarily unavailable"; single-process node --test runs are fine, whole-dir runs wedge.
