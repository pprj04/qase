# Phase 15B — Split app.js into Modules

## Goal
Break the monolithic 4,250-line app.js into focused ES modules for maintainability.

## Files Changed
- `public/shared.js` (NEW, ~227 lines) — el refs, state, api/toast/escapeHtml/markdown/helpers, STEP_ICONS, CRON_PRESETS
- `public/bugs.js` (NEW, ~495 lines) — bug management, board, detail drawer, editor, initBugsWiring()
- `public/tests.js` (NEW, ~1301 lines) — test cases, suites, editor, test execution
- `public/pipeline.js` (NEW, ~289 lines) — pipeline visualization, dev intelligence
- `public/app.js` (trimmed from 4,250 to ~1,973 lines) — runs/sessions, chat, workflows, regression, metrics, export, settings, SSE, boot

## Acceptance Criteria
- [x] All 5 modules load without console errors
- [x] Runs page renders (sessions, composer, transcript)
- [x] Bugs page renders (board with data)
- [x] No cross-module ReferenceErrors (STEP_ICONS, CRON_PRESETS shared via shared.js)
- [x] All ES module imports/exports correct
- [x] No duplicate definitions across modules
