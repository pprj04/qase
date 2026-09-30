# Phase 7 · Coverage dashboard: matrix with clickable cells + coverage metrics

## Goal
One place answers "what has been tested, where, and with what result" — a coverage matrix joining test cases × environments against executed runs, plus summary coverage metrics. Honest by construction: never fabricates a pass; only executed runs with a recorded verdict count as covered.

## Data contract — GET /api/coverage
Server-side aggregation (list payloads lack verdicts and cap at 100 runs):
- `services.testCases.list()` (not-deleted cases) × `services.environments.list()` × full run history.
- Response:
  - `metrics`: { environments, testCases, assignedPairs (case×env assignments), executedPairs (pairs with ≥1 done run), passedPairs (latest done run per pair has report.verdict pass|pass_with_issues), coveragePct (executedPairs/assignedPairs, 0 when no assignments), passRatePct (passedPairs/executedPairs), runsConsidered }
  - `rows`: per test case: { caseNumber, title, tags, cells: { [environmentId]: { latestRunId, at, status, verdict, executionLevel } | undefined (never run) }, executed, total }
  - `environments`: [{ envId, device, platform, browser, browserVersion, os, osVersion }] — column dimension, active only.
- Join key: `session.testCaseId` stores the case **caseNumber** (not uuid). Environment join: `session.environmentId` ?? `environmentSnapshot.envId`.
- "Latest" = most recent by `updatedAt` among runs with status done/error (a verdict exists only after completion; a done run without report counts as executed with verdict undefined — shown as such, not as a pass).

## UI — Device Matrix dialog, new "Coverage" tab
- `data-dm-tab="coverage"` / `data-dm-pane="coverage"` following the existing tab pattern; render line added in `wire()`.
- Metrics strip: coverage %, executed/assigned pairs, pass rate, environments and test case counts.
- Matrix table: rows = test cases, columns = environments (device · browser). Cell states: never-run (empty), executed-with-verdict (color by verdict: pass green, pass_with_issues amber, fail red, blocked gray, undefined/none neutral "executed"), running/awaiting (live).
- Clickable cells: click a cell → detail popover listing that pair's run history (run id, date, status, verdict, execution level) with an "Open run" action. Click a never-run cell → option to start a run for that case+environment (reuses the Phase 11 one-click path when practical; otherwise shows the guidance to use Run on the Environments tab).
- textContent-only rendering (XSS-safe), same imperative DOM pattern as renderEnvironments.

## Acceptance criteria
- [ ] GET /api/coverage returns metrics + rows + environments computed from real stores; empty workspace → zeros/empty, not an error
- [ ] Coverage % = executedPairs/assignedPairs; no pass counted without a verdict
- [ ] Matrix renders one row per not-deleted test case; cells keyed by environmentId
- [ ] Clickable cells show per-pair run history; Open run navigates to the run
- [ ] Metrics strip shows coverage, executed/assigned, pass rate
- [ ] Unit tests for the aggregation (pure function) cover: empty state, executed-no-verdict, latest-run selection, removed environments, deleted cases excluded
- [ ] Full suite green; reviewer + tester rounds
