# Phase B2 — Per-browser results board & required status set

## Goal
Give every browser/version its own result with the exact required statuses, live during
execution and after completion — the missing Phase-4 layer plus alignment to the requested
vocabulary. Statuses must be explicit: PASSED, FAILED, RUNNING, QUEUED, NOT RUN, NOT SUPPORTED,
UNAVAILABLE, ERROR (plus existing PENDING/BLOCKED/CANCELLED retained). Never convert NOT RUN /
UNAVAILABLE / NOT SUPPORTED into PASSED.

## Work
- `server/matrixService.js` status mapping to the user-facing set: PENDING→QUEUED (when
  scheduled) — keep raw statuses, add display mapping; ensure deselected-but-recorded items
  surface as NOT RUN with reason "Deselected by user." (exists at `matrixService.js:96–100`,
  `147–149` — expose in run payload).
- `public/qaMatrixResults.js` (new, + tests): pure model — per-browser rows
  (browser, version, runner/provider, platform/OS, availability, selected state, status,
  result), grouping/filtering (device category: Windows/macOS desktop, iPhone/Android phone,
  iPad/Android tablet — reuse `matrixCoverage.categoryOf` labels), totals (planned/completed/
  passed/failed/blocked/not-run), honest-pass guard in the model layer.
- `public/app.js` / `deviceMatrixView.js`: run-scoped results board using the model —
  live updates from `matrix_item` SSE + polling fallback, drill-in to a configuration's
  session (existing session view), per-item retry, run-level cancel. DuckDuckGo row must
  appear as NOT SUPPORTED with its reason even when nothing was executed.
- Reports: per-browser rows in the report matrix section (extend existing layer), evidence
  (screenshots/logs) attached per configuration, never merged.

## Acceptance criteria (true in running app)
- [ ] The run view shows a row per selected browser/version with status, runner, platform and version.
- [ ] All required statuses render distinctly (incl. NOT RUN for deselected, NOT SUPPORTED for DDG, UNAVAILABLE for missing providers).
- [ ] Statuses update live during the run (QUEUED → RUNNING → terminal).
- [ ] Drill-in from a row opens that configuration's session evidence (screenshots/logs).
- [ ] No unexecuted browser ever shows PASSED (guard + tests).
- [ ] Results group correctly by device category (Windows/macOS desktop, iPhone/Android phone, iPad/Android tablet).

## Tests
- Model: mapping, grouping, totals, honest-pass guard, DDG-not-supported row rendering from fixture.
- SSE live-update test; drill-in test; API payload test (per-item runner/provider/availability fields).

## Edge cases
- Blocked-before-launch item → logs only, no fabricated screenshot; hundreds of rows →
  windowed rendering (reuse the dialog's Load-more pattern); cancelled run → statuses frozen, retry offered.
