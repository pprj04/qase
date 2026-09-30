# Phase 12 · Run-screen environment + bulk progress integration & regression

## Goal
Integrate environment info and bulk-run progress into the EXISTING run screen (run-summary region) without disrupting anything: RUNNING header with test-case name, environment count, current environment, progress; bulk progress bar (Completed/Running/Passed/Failed/Pending) aggregating the batch of sessions launched by a wizard/bulk run. Then a full regression pass proves backward compatibility.

## Current state (audited)
- `#run-summary` (index.html:117-141) with collapsible detail (`#run-summary-detail`) and token row — the natural host; `setRunSummaryCollapsed` (app.js:629) already manages states.
- One session = one environment (snapshot on session). Bulk runs are N sequential sessions — there is no server-side batch entity. Client-side aggregation over the launched session ids is correct and sufficient; persist the batch (id list + label) in localStorage so progress survives reload.
- Session status currently: queued/running/done/failed + report verdict for pass/fail.

## Files to change
- `public/index.html` — extend `#run-summary-detail` with: test-case title line (when linked), environment block (count + current env: device / OS / browser), bulk progress block (label e.g. FULL REGRESSION, total executions, progress bar, Completed/Running/Passed/Failed/Pending counts, expandable per-session list).
- `public/app.js` — batch registry: when bulk/wizard launches N sessions, record {label, sessionIds, testCaseTitles} in localStorage; a poller (reuse existing session refresh/SSE) aggregates statuses into the progress block; single-session runs show just the environment block (count 1) — never an empty bulk widget. Current-environment line reads the selected session's `environmentSnapshot`.
- `public/styles.css` — progress bar, env block, per-session expandable list (default collapsed).
- No server changes required.

## Acceptance criteria (running app)
- [ ] A run started from a test case shows: RUNNING + test-case title + environment (device/OS/browser) in the run-summary region; existing token row, findings count, progress card all still render.
- [ ] A bulk run of N sessions shows a progress block: label, total executions, progress bar %, Completed/Running/Passed/Failed/Pending counts; percentage and counts update live as sessions finish.
- [ ] The per-session execution list is collapsed by default and expands on demand (technical detail stays available but out of the way).
- [ ] Reloading the page mid-batch restores the progress block (batch persisted locally).
- [ ] A plain (non-batch) run never shows a bulk progress widget.
- [ ] Nothing existing is disrupted: Recent Sessions, Performance, Agent Log, browser preview, Findings, Report, SQA, Founder mode, composer input all function exactly as before.

## Tests
- Unit: status aggregation math (queued/running/done+verdict → Completed/Running/Passed/Failed/Pending), percentage, batch persistence/restore.
- Browser (tester): single-run env block; 3-case × 2-env batch live progress; reload mid-batch; regression checklist of existing panels.

## Edge cases
- Session deleted mid-batch — counts adjust; no divide-by-zero.
- Mixed verdicts (some sessions have no report yet) — counted as Running/Pending, never fabricated as Passed.
- Batch of 1 (wizard degenerate case) — render as simple run, not a 1-item progress table.

---

# Regression checklist (end of phase)
- [ ] npm test fully green; existing Phase 1–8 acceptance criteria still hold (spot-check catalog CRUD, environment editor persistence, test-case CRUD, bulk launch).
- [ ] Login/roles: developer cannot write catalog; tester flows unaffected.
- [ ] Preview loads; drawer, dialogs and dock don't overlap on 1280px and 768px widths.
