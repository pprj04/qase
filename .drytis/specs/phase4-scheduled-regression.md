# Phase 4 — Scheduled Regression Runs

## Goal
Automatically re-run test suites on a schedule (e.g., 2×/week). Dashboard shows regression trends and run history. Schedules are user-managed via the UI.

## Files to Change

### New: `server/scheduler.js`
- Schedule CRUD + cron-based trigger
- `tick()` called every 60s via setInterval on server boot
- `executeSchedule()` calls `runTestSuite()` from replay.js
- Uses `cron-parser` npm package for next-run calculation

### New: `server/regressionStore.js`
- Persistence for regression run results (`.qase/regression-runs.json`)

### Modified: `server/index.js`
- Import scheduler functions + start the tick loop on boot
- Add routes: GET/POST/PUT/DELETE `/api/schedules`, POST `/api/schedules/:id/run`, GET `/api/schedules/:id/runs`

### Modified: `public/index.html`
- Add "Regression" tab in the right panel (7th tab)

### Modified: `public/app.js`
- Regression tab rendering: schedule list, create form, trend chart, run history
- Manual "Run Now" button per schedule
- Create/edit/delete schedules

### Modified: `public/styles.css`
- Styles for schedule cards, trend bars, run history

## Acceptance Criteria
- [ ] User can create a schedule with cron expression, target URL, and selected test cases
- [ ] Scheduler ticks every 60s and triggers runs when due
- [ ] Run results appear in regression history with pass/fail counts
- [ ] Schedules can be enabled/disabled
- [ ] Manual "Run Now" works for any schedule
- [ ] Run history persists across restarts
- [ ] Regression tab shows trend chart (pass/fail over time)
