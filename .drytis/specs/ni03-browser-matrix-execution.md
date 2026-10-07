# NI03 · Browser matrix in execution & picker

## Goal
The 7-browser matrix (Chrome, Edge, Firefox, Safari, Opera, Brave, DuckDuckGo) integrated into selection and execution with honest statuses. Extends the existing picker (`devicePicker.js`, `matrixSidebar.js`, `matrixColumns.js`) and run-start flow.

## Work
1. **Picker integration**: device/browser matrix view supports per-device browser multi-select with the FULL supported set selected by default (from capability resolution NI01 Phase 2); DuckDuckGo visible but locked to NOT SUPPORTED (reason shown inline). Deselect persists for the run. Existing star/favorite, search, columns, navigation, styling, responsive behavior unchanged.
2. **Run start**: `POST /api/sessions` (and matrix-run endpoint) accept `browsers[]` per environment; the run/matrix expands to profile items per selected browser; deselected browsers → NOT RUN items recorded.
3. **Honest status rules enforced in data**: status transitions only PASSED/FAILED/… via actual execution outcomes. Add a guard in the result writer: writing PASSED requires a completed execution record (sessionId/artifacts) — otherwise persisted as ERROR/NOT RUN. UI renders the full status set distinctly (PASSED, FAILED, NOT RUN, UNAVAILABLE, NOT SUPPORTED, BLOCKED, ERROR) with distinct colors/icons.
4. **Version handling**: version selection driven by provider capability list (local Playwright builds / BrowserStack list); catalog's curated versions shown as inventory; only executable ones selectable for runs.
5. **MANOJ defaults successor**: the default matrix (all supported browsers selected, all 6 device categories represented) is the default at run start; existing stored default environment/picker defaults remain untouched.

## Tests
- UI test: default selection = full supported browser set; deselecting Opera excludes it → its item is NOT RUN.
- API test: status-guard rejects PASSED without execution evidence.
- API test: DuckDuckGo selection attempt → rejected or forced to NOT SUPPORTED with reason.

## Edge cases
- Deselection mid-run not allowed (matrix is frozen at launch; recorded as requested set).
- BrowserStack creds arriving later don't retroactively change past item statuses.

## Acceptance criteria (running app)
- [ ] Starting a run with defaults executes every supported browser; the summary shows honest per-browser results.
- [ ] A deselected browser appears as NOT RUN and can never show PASSED.
- [ ] An unsupported browser (DuckDuckGo) shows NOT SUPPORTED with reason, everywhere it appears.
