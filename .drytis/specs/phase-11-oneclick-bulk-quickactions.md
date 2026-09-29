# Phase 11 · One-click Test Cases + 3-step Bulk Runs wizard + Quick Actions & presets

## Goal
Make Test Cases, Bulk Runs, and Quick Actions a single simple workflow for non-technical users while keeping the existing technical surfaces (envIds, advanced editor) for power users. Backend unchanged except a "last run" summary field on test cases if cheap; otherwise client-side aggregation.

## Current state (audited)
- `public/testCaseView.js`: table + multi-select envs; Run button opens the QA start modal (not one-click). `createQaRunWithCase` in app.js posts `/api/sessions` with testCaseId + environmentId — one-click just calls this directly.
- `public/bulkRunView.js`: single-step; `pairsToRun(cases, mode)` already computes the case×env matrix.
- No Quick Actions area; feature dock (`.feature-dock`, index.html:242-268) is the natural host.
- No bug-creation feature exists — "Create Bug" quick action opens a prepared bug report (markdown download / clipboard) from the latest failed run's findings, since the full BUG-XXX entity is Phase 6 (separate, not in this request's scope).

## Files to change
- `public/testCaseView.js` — card/table renderer upgrade: each case shows Name, Description, Platforms (derived from assigned envs), Device/OS/Browser line, Last Run (from `GET /api/sessions` filter by testCaseId — client-side, cached), Status (Passed/Failed/Running/Not run — from the report verdict of the last session); prominent [Run] button → run-target dialog (Current Device / All Selected Devices / Choose Devices) then executes via `createQaRunWithCase` per pair; keep Edit/Delete/Advanced for technical users.
- `public/bulkRunView.js` — 3-step wizard: (1) what to run — All Test Cases / Selected Test Cases / Failed Results / Not Run Recently (client-side filters over test cases + last-session status; "Test Suite" omitted unless suites exist — do not fake it); (2) where — Current Device / Saved Environment (pick) / Multiple Devices (opens device drawer selection); (3) summary — Tests × Devices = Total executions, single [Run N Tests] button launching the existing per-pair loop.
- `public/app.js` — quick-actions strip (Run All Tests, Run Failed Tests, Create Test Case, Choose Devices, View Results, Create Bug) in/near the feature dock; presets dropdown (Apple Mobile, Android Mobile, Windows Desktop, All Mobile, All Browsers, Full Regression) that pre-selects environments by platform/type filter and hands off to bulk run; Create Bug → generates a markdown bug report from the most recent failed session's findings (clipboard + download).
- `public/index.html` — markup for run-target dialog, wizard steps, quick actions, presets.
- `public/styles.css` — card layout, wizard steps, quick-action chips.
- Unit tests: run-target resolution (default env / all / choose), wizard counting (tests × devices), last-run status aggregation, preset → environment-set mapping.

## Acceptance criteria (running app)
- [ ] Test Cases opens as a panel of cards/table; each card shows Name, Description, Platforms, Device/OS/Browser, Last Run, Status.
- [ ] Clicking [Run] on a card with a default environment starts the run immediately (session appears in Recent Sessions) — no configuration steps.
- [ ] Clicking [Run] with multiple environments shows only: Current Device / All Selected Devices / Choose Devices + [Run Test].
- [ ] Bulk Runs is a 3-step wizard with an auto-calculated summary (Tests: N, Devices: M, Total executions: N×M) and one primary [Run N Tests] button; no manual counting.
- [ ] "Failed Results" and "Not Run Recently" filters produce correct case sets based on actual last-session data.
- [ ] Quick Actions are reachable without opening any menu deeper than one click; each performs its labeled action (Run All, Run Failed, Create Test Case, Choose Devices, View Results, Create Bug).
- [ ] Presets (Apple Mobile, Android Mobile, Windows Desktop, All Mobile, All Browsers, Full Regression) select the matching environments and drop the user into the bulk-run summary.
- [ ] Create Bug produces a bug report (title, expected/actual, environment, steps) for the latest failed run without requiring any technical input.
- [ ] All existing functionality still works: technical table view reachable, Edit/Delete intact, bulk per-pair failures still reported, sessions/agent/findings/reports/SQA/Founder unaffected.

## Tests
- Unit: wizard count math; last-run aggregation (pass/fail/never); preset mapping; run-target resolution.
- API: unchanged endpoints — integration tests only where a new field is added.
- Browser (tester): one-click run, wizard summary math, preset selection, quick actions, Create Bug output.

## Edge cases
- Test case with zero assigned environments — Run falls back to Current Device emulation with a clear note.
- Large N×M (e.g. 25×8=200) — wizard warns about execution count and estimated duration before launching; launch is sequential with progress.
- No failed runs yet — Run Failed Tests shows a friendly empty state, not an error.
- Sessions API slowness — last-run column loads progressively, cards render first.
