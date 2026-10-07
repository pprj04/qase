# Round-3 Recheck — Ticket #14937 (2026-04)

Verdict: PASS on all 4 points; point 3 live re-run INCONCLUSIVE (env), point 4 live POST not independently reproducible (env).

1. matrixApi.test.js: 7/7 pass via direct `node server/matrixApi.test.js` (123s, exit 0). New tests at lines 176-249 cover cancel (404 unknown run, PENDING→CANCELLED w/ reasons, run cancelled, no PENDING left) and retry (404/409 unknown ids, PENDING refused, FAILED ×2 retries then 409 bound, PASSED refused). Note: retry test drives FAILED items though its title says CANCELLED; QUEUED→CANCELLED flip covered only at orchestrator level (documented in test comment) — acceptable, resolves the round-1 FAIL.
2. retryCount persistence verified statically: seed at creation (matrixService.js:368), rowToItem mapping (postgres/matrixRunRepository.js:79 `retry_count ?? 0`), updateItem column map (line 230), migration 036 (ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0). postgres/matrixRunRepository.test.js 7/7 pass.
3. Orchestrator hang fix verified by code: cancel test now settles hanging sessions (`interrupted`, matrixOrchestrator.test.js:382-387) — removes the 8-min waitForSession tail. Live re-run impossible: box hit permanent fork/uv_thread_create exhaustion mid-review (>1h of retries; node aborts at startup before running any test).
4. Deployment: server restarted (pid 2494, fresh uptime vs round-2's stale pid 69). Cap code confirmed in app.js:872-890 (MAX_MATRIX_CONFIGURATIONS=2000, 422). Could NOT independently re-issue the 2001-envId POST or fetch matrix-muxbhjux-d7375a6e (fork lockout); requester's live evidence taken on report.

Env note: the box's fork/thread exhaustion is now effectively permanent (kernel threads-max 15368, RLIMIT_NPROC 7684, ~100 pids visible, load 0.00 — an unseen shared-limiter condition, not load). Any reviewer on this box should run tests EARLY, not after file reads; file tools (read_file) keep working during lockout.
