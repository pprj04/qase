# Phase 9B — Parallel Execution & Retry

## Goal

Execute test suites in parallel with a configurable worker pool, and retry failed tests automatically to detect flaky tests. A 50-test suite should complete in ~5 minutes instead of ~30.

## Acceptance Criteria

### Parallel Execution
- [ ] `runTestSuite()` accepts a `concurrency` option (default from QASE_PARALLEL env, fallback 3)
- [ ] Tests are executed in parallel batches of `concurrency` size using a worker pool
- [ ] Each test case gets its own fresh browser instance (no shared state)
- [ ] Results are returned in the same order as input (stable, deterministic output)
- [ ] Concurrency is configurable: QASE_PARALLEL env var, overridable per-run via API option

### Retry on Failure
- [ ] `runTestSuite()` accepts a `retries` option (default from QASE_RETRIES env, fallback 1)
- [ ] A failed test case is automatically re-run up to `retries` times
- [ ] If a test passes on retry, it is marked `flaky: true` and `result: 'pass'` (not fail)
- [ ] If a test fails all attempts, `result: 'fail'`, `flaky: false`, and the last attempt's error/screenshots are kept
- [ ] Each result carries `attempt` (1-based count of how many tries it took)
- [ ] Retry only applies to `fail` results, not `error` results (error = browser crash, infrastructure issue)

### Summary Enrichment
- [ ] Summary object includes `flaky` count alongside passed/failed/errored
- [ ] JUnit XML system-out includes "flaky" note for retried-passed tests
- [ ] Dashboard/regression trend can show flaky count

### Frontend
- [ ] Run results show ⚠️ badge for flaky tests with tooltip "Passed on attempt N"
- [ ] Run All summary toast includes flaky count
- [ ] Schedule run summary includes flaky count

## Files to Modify
- `server/replay.js` — parallel pool, retry logic, flaky detection
- `server/index.js` — pass concurrency/retries from env or API body to runTestSuite
- `server/junit.js` — flaky note in system-out
- `server/regressionStore.js` — store flaky count in run summary
- `server/metrics.js` — flaky in dashboard metrics
- `public/app.js` — flaky badges in results, flaky in summary toast
- `public/styles.css` — flaky badge style
