# Phase 9C — Persistent Run Artifacts & Per-Test History

## Goal

Screenshots currently live as ephemeral base64 in the result object and are stripped to a count when persisted to replayStore. Per-test-case run history exists in the backend (`GET /api/test-cases/:id/runs`, 50 runs) but is never shown in the UI. This phase persists evidence to disk and surfaces the history timeline.

## Sub-features

### A. Screenshot Persistence
- Screenshots saved as JPEG files to `.qase/artifacts/<run-id>/step-N.jpeg`
- `replayStore.addRun()` stores screenshot file paths (relative) instead of stripping to a count
- New route: `GET /api/artifacts/:runId/:filename` serves artifact files from disk
- Full result (with base64 dataUrls) still returned in the immediate API response for instant display
- Historical runs fetch screenshots lazily from the artifact route

### B. Per-Test-Case Run History UI
- New expandable "History" section on each test case card
- Fetches `GET /api/test-cases/:id/runs` (already exists, returns max 50 runs sorted newest-first)
- Each history entry shows: timestamp, result badge (pass/fail/error), duration, flaky badge, screenshot thumbnails
- Click a history entry to expand its full step-by-step results and assertion outcomes
- Screenshot thumbnails use the artifact route for persistent images
- Lazy-loaded (fetched when user expands the History section)

### C. Playwright Trace Recording
- Trace recording enabled during test case execution (`context.tracing.start()`)
- Trace saved as a `.zip` artifact to `.qase/artifacts/<run-id>/trace.zip`
- Download link in the result view
- Trace captures screenshots, DOM snapshots, network, and console logs at every step

## Acceptance Criteria
- [ ] Screenshots are written to disk as files and survive container restarts
- [ ] `replayStore.addRun()` stores screenshot file paths, not just counts
- [ ] `GET /api/artifacts/:runId/:filename` serves screenshot files
- [ ] Test case cards have an expandable "History" section
- [ ] History shows last 50 runs with timestamp, result badge, duration
- [ ] History entries expand to show step results, assertion results, and screenshot thumbnails
- [ ] Screenshot thumbnails in history load from the artifact route (persistent)
- [ ] Playwright trace is recorded and downloadable as a .zip

## Files to change
- `server/replay.js` — save screenshots to disk, add trace recording
- `server/replayStore.js` — store screenshot paths, add trace path
- `server/index.js` — add `GET /api/artifacts/:runId/:filename` static route
- `public/app.js` — add history section to test case cards, lazy-load + expand
- `public/styles.css` — history timeline styles
- `tests/phase9c-artifacts-history.test.js` — integration tests
