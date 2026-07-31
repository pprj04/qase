# Phase 10 — Visual Regression / Screenshot Diffing

## Goal

With screenshot persistence now in place (Phase 9C), use those artifacts to detect visual regressions automatically. Compare test run screenshots against stored baselines, report pixel-level diffs, and provide a UI to review and approve visual changes.

## Sub-features

### 10A — Baseline Management
- First successful (passing) run of a test case auto-stores screenshots as baselines
- "Approve Baseline" button to manually set/update baseline from any run
- Baselines stored per test case, keyed by screenshot position (step index / assertion index)
- Persistence: `.qase/baselines.json`
- `GET /api/baselines/:testCaseId` — list baselines with artifact paths
- `POST /api/test-cases/:id/approve-baseline` — promote current screenshots to baseline
- Baseline screenshot files copied to `.qase/artifacts/baselines/<testCaseId>/`

### 10B — Screenshot Diffing Engine
- New assertion type: `visual_match` with optional `threshold` (default 0.1% = 0.001)
- Install `pixelmatch` + `pngjs` (pure JS, no native compilation)
- On `visual_match` assertion: capture screenshot, compare against baseline
- Diff result: `{ pixelDiff, totalPixels, pctChanged, passed, diffPath }`
- Diff image (red overlay on changed pixels) saved as artifact
- Visual regression failure = test case result = 'fail'

### 10C — Diff Viewer UI
- Visual regression badge (🎨 VISUAL) on test results
- Side-by-side viewer: Baseline | Actual | Diff overlay
- "Approve" button to update baseline from current run
- Diff images viewable inline in result rendering
- Visual regression count in suite run summary

### 10D — Phase 8 Polish + Security Fix
- Suite tree node click → filters test case list to that suite
- "Move to suite" dropdown on test case cards
- Fix pre-existing XSS in `renderRunResult()` — escape `sr.action`

## Acceptance Criteria
- [ ] First passing run auto-stores screenshots as baselines
- [ ] `POST /api/test-cases/:id/approve-baseline` promotes current run screenshots
- [ ] `GET /api/baselines/:testCaseId` returns baseline metadata + artifact paths
- [ ] `visual_match` assertion compares current screenshot vs baseline
- [ ] Diff produces pixel count, percentage, and diff image
- [ ] Visual regression failure appears in results and JUnit XML
- [ ] Diff viewer shows baseline / actual / diff side-by-side
- [ ] "Approve" updates baseline and clears the regression
- [ ] Suite tree click filters test case list
- [ ] "Move to suite" dropdown on test cards
- [ ] XSS fix: `sr.action` escaped in `renderRunResult`

## Files to change
- `server/baselines.js` — NEW: baseline CRUD + persistence
- `server/replay.js` — visual_match assertion evaluation + baseline capture
- `server/junit.js` — visual regression annotation
- `server/index.js` — baseline routes + approve endpoint
- `public/app.js` — diff viewer, suite filtering, move-to-suite, XSS fix
- `public/index.html` — visual_match in assertion type list
- `public/styles.css` — diff viewer styles, visual badge
- `tests/phase10-visual-regression.test.js` — integration tests
