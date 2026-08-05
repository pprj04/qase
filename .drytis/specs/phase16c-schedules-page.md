# Phase 16C — Schedules Page

## Goal
Surface the hidden Regression Schedules feature as a first-class page. Users can view pass-rate trends, create/edit/delete schedules, toggle enable/disable, and manually trigger runs — all without needing a session context.

## Changes
- **router.js**: Added `'schedules'` to PAGES array
- **index.html**: Added nav link (Runs · Tests · Workflows · Schedules · Bugs), added `#page-schedules` container with header, stats, trend, and list
- **schedules.js** (new, 411 lines): Project-scoped schedule management module
  - `loadSchedulesPage()` — fetches schedules + trend from API
  - `renderSchedulesStats()` — stat chips (schedules, active, test cases)
  - `renderTrendSection()` — CSS bar chart with pass rate per run, color-coded (green ≥80%, amber ≥50%, red <50%)
  - `renderScheduleCard()` — card with name, enable/disable toggle, meta line (cron, test count, host, last run, next run), Run Now + Delete buttons
  - `buildScheduleForm()` — create form with name, cron presets + custom toggle, suite selector, target URL
  - `initSchedulesWiring()` — "New Schedule" button handler
- **shared.js**: Added el refs (schedulesList, schedulesStats, schedulesTrend, btnNewSchedule)
- **app.js**: Added import + routechange handler + initSchedulesWiring() in boot
- **styles.css**: ~250 lines of schedules page CSS

## Acceptance Criteria
- [x] Schedules nav link visible between Workflows and Bugs
- [x] Clicking Schedules navigates to #/schedules
- [x] Page shows stats chips (schedule count, active count, test case count)
- [x] Pass rate trend chart visible when data exists
- [x] All schedules listed as cards with name, toggle, meta, actions
- [x] "+ New Schedule" button opens inline create form
- [x] Create form has name, cron presets, custom cron toggle, suite selector, target URL
- [x] Cancel closes the form
- [x] Run Now triggers manual execution
- [x] Delete removes schedule
- [x] No JS console errors
