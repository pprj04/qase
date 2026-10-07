# NI04 · Coverage verification, findings context & gap report

## Goal
End-to-end verification + coverage gap report generated from actual execution data. Extends `server/coverageService.js` and findings/coverage UI; no new dashboard.

## Work
1. **Coverage service extension**: `computeCoverage()` extended to aggregate matrix-run items: devices (✓/⚠ per category), browsers (✓ Chrome/Edge/Firefox/Safari/Opera/Brave, ⚠ DuckDuckGo — reason), execution summary (profiles requested/executed/passed/failed/unavailable/not supported) — every number computed from stored items, zero hardcoding.
2. **Findings UI with profile context**: findings rendered per profile (device, OS, browser, version, status, error/finding, execution time) — extend `renderFindings`/bug view env badge pattern (`bugsView.js envText`) to matrix items; keep existing structure.
3. **Coverage gap report**: `GET /api/coverage` extended (+ per-matrix-run section); rendered in the existing coverage tab (`deviceMatrixView.js renderCoverage`) and in the run report (`server/report.js`) — requested vs executed vs outcomes, with reasons for every gap.
4. **End-to-end validation**: scripted NI04 checklist run — device selection, browser selection, defaults, deselect, automatic mobile/tablet/desktop execution, browser execution, result collection, findings display, error handling, unsupported, unrun, failed, passed profiles — as an automated validation script (e.g. `scripts/ni04-validation.mjs`) asserting the final acceptance list; results reported honestly.
5. **Regression**: existing single-run flows, SQA/founder sessions, bugs CRUD, coverage tab for non-matrix runs unchanged.

## Tests
- Validation script covers all 15 NI04 verification points with assertions.
- Coverage numbers test: given seeded matrix items with known statuses, report matches exactly.
- Regression: existing /api/coverage shape preserved (additive fields only).

## Edge cases
- Empty matrix (nothing executed): report shows 0 executed and reasons; never invents.
- Interrupted matrix run: gap report accounts for ERROR items explicitly.

## Acceptance criteria (running app)
- [ ] After a representative matrix run, the coverage tab shows real counts (requested/executed/passed/failed/unavailable/not supported) matching the run's items.
- [ ] Findings list shows device + OS + browser + version + status + time per profile.
- [ ] DuckDuckGo line reads "runner unavailable" (or truthful equivalent) with no pass implied.
- [ ] The existing app (single runs, bugs, reports) behaves as before.
