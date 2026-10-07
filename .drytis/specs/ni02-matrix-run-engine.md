# NI02 Phase 1 · Server-side matrix run engine

## Goal
One shared workflow executed across many device/browser profiles, server-orchestrated — instead of the current client-side loop (`public/bulkRunView.js` launchPairs → POST /api/sessions per pair). Extend the existing run domain; do not fork it.

## Work
1. **Matrix run object**: a matrix run = { id, title, testCaseIds/workflow ref, requestedProfiles[], defaults snapshot, status, createdAt }. Store as new records in both stores (postgres: new additive migration `qa_matrix_runs` + `qa_matrix_run_items`; local store: JSON store sections), keyed by the stable profileId from NI01 Phase 1.
2. **Server endpoint**: `POST /api/matrix-runs` { testCaseId | workflow, profiles[], browsers per profile } → creates matrix run, spawns items. `GET /api/matrix-runs/:id` returns items with live status. Items report progress via existing session events/streams.
3. **Orchestration**: reuse the existing per-run machinery — for each requested profile item: if capability=not_supported → item status NOT SUPPORTED (reason) without launching; if unexecutable → UNAVAILABLE/BLOCKED (e.g. no BrowserStack creds for REAL_DEVICE); else launch existing session flow (`POST /api/sessions` internals) with the environment snapshot for that profile, tagged with matrixRunId. Concurrency-limited (config, e.g. 2–3 concurrent local sessions; BrowserStack parallel per plan).
4. **Per-profile result records** (both stores): profileId, device, OS, browser, browserVersion, executionLevel, runner/provider, status, error, startedAt/finishedAt, durationMs, actual/expected, artifact refs (screenshot/video when produced), sessionId link. Statuses: PASSED | FAILED | NOT RUN | UNAVAILABLE | NOT SUPPORTED | BLOCKED | ERROR — persisted, never derived from absence.
5. **Default profile matrix (the "MANOJ defaults" successor)**: server-side definition of the default profile set = one representative per category: iPhone, Android phone, iPad, Android tablet, Windows, macOS × full supported browser set. Users may deselect; deselection is recorded per matrix run. Preserve existing default-selection UX (default env in picker, core SQA profiles checked) — this adds a matrix-level default, doesn't replace picker defaults.
6. **NOT RUN state**: items deselected by the user are recorded as NOT RUN (with reason "deselected by user") so they can never render as PASSED.

## Tests
- API tests: create matrix run with 1 case × [supported, unsupported, deselected] profiles → statuses PASSED/FAILED, NOT SUPPORTED, NOT RUN respectively, persisted.
- Local-store and postgres-store parity test (same shape both stores).
- Concurrency cap test.

## Edge cases
- Matrix run interrupted (container restart) → items stuck RUNNING become ERROR with reason "interrupted" on resume scan; never left as PASS.
- Workflow shared, not duplicated: test case definition is single; only profile changes (verify test_cases not cloned).

## Acceptance criteria (running app)
- [ ] One shared workflow run across the 6 default categories produces 6+ per-profile result rows with device+OS+browser+version+duration+status.
- [ ] Unsupported/deselected profiles show NOT SUPPORTED / NOT RUN — never PASSED.
- [ ] Matrix run survives page reload with per-profile statuses intact.
