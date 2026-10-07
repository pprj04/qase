# Ticket #14649 review — NI02 Phase 1 matrix run engine (2026-10-05)

## Round 2 verdict: PASS in the deployed (local-store) app; one residual postgres defect

### Round-1 critical #1 (emit-hook crash) — FIXED, verified live
app.js emit hook now uses `services.runs?.bus?.emit(matrixRunId, {…})` (raw run-store
EventEmitter, exposed on both localServices:204 and postgresServices:243 run stores),
wrapped in try/catch — fan-out can never stall execution. Independently re-verified live:
created a matrix run via authed+CSRF POST (1 profile × chrome+duckduckgo) → ran to
`done`; chrome item launched a real session (b95d88ec, verdict blocked, duration 40s),
DDG stayed NOT_SUPPORTED. Emit of matrix_run_started/matrix_item no longer throws.
Leader's 18-item run matrix-muv0659q on disk: done, 9 BLOCKED (real sessions, real
durations 28–116s) + 9 NOT_SUPPORTED; reviewer round-1 stuck run matrix-muuzmq4s swept
to `error` by resumeRecovery. matrixApi.test.js (4 tests) mounts REAL app composition —
the fake-blindness gap is closed for local mode.

### Round-1 critical #2 (uuid vs text id) — migration FIXED, but postgres READ path still broken
Migration 031 now `id text PRIMARY KEY`, items `matrix_run_id text FK` (+ test guard).
BUT `matrixRunRepository.loadItems` (matrixRunRepository.js:82) still reads
`WHERE matrix_run_id = ANY($1::uuid[])` — casting the service's `matrix-*` text ids to
uuid throws `invalid input syntax for type uuid` on every postgres list()/get(). Under
QASE_RUN_STORE=postgres: INSERTs succeed, then GET list/:id → 500. Not caught because
matrixRunRepository.test.js FakeClient stubs `SELECT *` with empty rows. Fix: `::text[]`.
(Residual from round-1 defect — same area, same "fixed" claim; insert path fixed, read path not.)

### WARNs
- matrixApi.js:19 passes `{ ownerUserId: request.auth?.userId }` as create() options,
  but create() only destructures defaultsUsed → owner attribution silently dropped
  (record.ownerUserId always null unless in body).
- Item records lack spec work-item-4 fields: executionLevel, runner/provider,
  artifact refs (screenshot/video). (deviceType/browserSupport present.)
- updateItem honest-state guard nominal: any non-empty sessionId string unlocks
  PASSED/FAILED (not HTTP-routed — internal only).
- Orchestrator sessions carry testCaseId but no testCaseSnapshot (app.js:659-670);
  app.js:667 `items[0].testCaseId ?? item.testCaseId` quirk.
- Swept error runs keep orphaned PENDING items (start requires status `pending`);
  matrix-muuzmq4s has 9 PENDING items that can never run.
- Concurrency now configurable (QASE_MATRIX_PARALLEL, clamp 1–4, default 1) ✓;
  no dedicated cap test beyond code read.
- Uncommitted on NIHARIKA — 5th consecutive review; origin/DEV (f04f78d) has none of it.

### Verified good
- Deselection: run-level `browsers` input → NOT_RUN "Deselected by user." items
  (matrixService.js:268-270, 147-149; HTTP test + live runs with 6 NOT_RUN on disk).
- sweepStaleRuns before every start; resumeRecovery on boot.
- Migration 031/032 RLS tenant policies, parameterized SQL, DDL-only 032; set_config
  pattern matches bug/environment repositories.
- Full suite 1231/0 fail/20 skipped; targeted 31 pass.

## Round 3 (targeted delta) — all three round-2 fixes verified, verdict PASS

1. **Postgres read path:** `loadItems` now `ANY($1::text[])` (matrixRunRepository.js:82); zero `::uuid[]`/`::uuid` casts remain in any matrix file. Guard test `item reads cast matrix_run_id to text[], never uuid[]` (matrixRunRepository.test.js:183-188) asserts both the absence and the presence of the correct cast against the actual source file. Parity defect closed (write path verified round 2; read path now consistent with migration 031 text ids).
2. **ownerUserId:** matrixService.create() accepts `{ownerUserId}` option; record uses `input.ownerUserId ?? option` (:257, :327). matrixApi.js:19 passes `request.auth?.userId`. **Live-verified over HTTP**: created run `matrix-muv16dca-cd05b2f4` (authed tester@qase.dev) carries `ownerUserId: "b42de709-…"` on the record. Also persisted: postgres repo column map includes owner_user_id↔ownerUserId; local backend stores the record verbatim.
3. **Restartable swept error runs:** route allows `pending` OR (`error` AND items contain PENDING), 409 otherwise (matrixApi.js:75-78); orchestrator's executeRun handles the restart correctly (sweep → status is 'error' not 'running' → proceeds, executes only PENDING items, existing ERROR/NOT_SUPPORTED items untouched, final → done). Pinned by HTTP test 'a swept error run with PENDING items can be restarted; a done run cannot' (orchestrator stubbed to a recorder — route-logic scope is appropriate; execution semantics pinned separately). Real swept runs exist on disk (matrix-muuzmq4s with 9 PENDING) — the fix addresses an actual state.

Tests: targeted matrix suites 33/33 pass; full suite 1233 / 0 fail / 20 skipped. Ticket close-worthy. Remaining WARNs (executionLevel/artifacts on items, nominal sessionId guard, no testCaseSnapshot) documented as Phase 2 (#14650). STILL UNCOMMITTED — 6th consecutive review.

## Round 4 (final close-out review, 2026-10-06)
Scope: full re-review incl. new since round 3 — migration 033 (item evidence columns),
engineForMatrixItem + collectArtifacts in app.js. Targeted suites 21/21 + repo/API suites;
full suite 1233 / 0 fail / 20 skipped. Live checks: created run (36 items: 6 PENDING
chrome, 27 NOT_RUN deselected, 3 NOT_SUPPORTED Safari-on-android/windows inventory gap),
ownerUserId persisted, unauth 401, javascript: URL 422. All round-2/3 fixes still in
place (text[] cast, ownerUserId, restartable swept runs). Migration registry pinned
through 033, currentVersion 33.

New WARNs found:
- Unknown testCaseId → 500 (TestCaseValidationError not in matrixApi's instanceof
  map; only MatrixValidationError → 422). API hygiene, not honesty.
- services.artifacts exists ONLY in localServices (grep postgresServices: 0 hits) —
  collectArtifacts degrades to [] in postgres mode; evidence silent.
- runRepository loadAggregate hydrates matrixRunId (:527) but replaceChildren/
  saveAggregate must not drop it on later saves (verify in #14650 — INSERT carries
  :747, full-replace UPDATE :862-897 also lists matrix_run_id, so OK).
STILL UNCOMMITTED — 7th consecutive review. origin/DEV = f04f78d has none of it.
