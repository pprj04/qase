# Fix: matrix run "created but not executing" (#14942)

## True root cause (not missing dispatch)
Execution WAS dispatching all along. The bug was **status corruption**:
`executeRun()` called `sweepStaleRuns()` → `resumeRecovery()` on EVERY
start, and resumeRecovery stamped **any** run with status 'running' as
`error` — including runs actively orchestrated in the same process. Start
run B while run A executes → A is stamped `error`, its sequential QUEUED
items (one-browser-at-a-time, ~90–110s each) keep running under a dead
status. User sees: rows QUEUED forever under an errored run.

## Fixes (server/matrixOrchestrator.js)
1. `resumeRecovery()` now skips `running.has(run.id)` — never touches runs
   live in this process. Boot-time recovery semantics unchanged.
2. Run completion honesty: `done` only when every item is terminal
   (QUEUED+PENDING+RUNNING === 0). Otherwise run → `error` with
   "<n> configuration(s) never reached a terminal state…" and an
   `errored: true` matrix_run_done event. Cancelled runs unchanged.

## Verified live (preview server)
- Two concurrent single-config runs: both `running/RUNNING` simultaneously
  (no more corruption), each ends `done`/BLOCKED independently.
- 5-config run: QUEUED→RUNNING→BLOCKED per item sequentially (~110s each),
  run `done` with statusCounts BLOCKED 5. Real Brave session, artifacts
  (evidence bundle + screenshot), fixture verdicts, sessionId per item.
- Suites: matrixOrchestrator 12/12, .rt2 2/2, .isolation 1/1.

## Notes
- Item verdict "blocked" = the QA agent pauses for approval/awaiting_input
  against example.com — honest agent behavior, NOT a dispatch failure.
- Old corrupted runs (pre-fix) remain error+QUEUED in history; user can
  Cancel them from the results board (cancel marks QUEUED → CANCELLED).
- Sequential pacing (~2 min/config) is the local one-browser contract;
  raise QASE_MATRIX_PARALLEL (1–4) only with a runtime that allows parallel
  browsers.
