# QA matrix current-state recon (phases 1–2 done, 3–5 NOT done)

Verified on branch NIHARIKA (merge 0cbdd85), 2026-10:

- Phase 1 (GET /api/qa-configurations) DONE: server/app.js:602-655 → server/qaConfigurations.js (toConfiguration, availabilityFor tri-state + NOT_CONFIGURED, buildQaConfigurations index mode).
- Phase 2 (launcher UI) DONE: public/index.html:769-790 (#qa-matrix-fieldset), public/qaConfigMatrix.js (pure model + createDeselectionStore localStorage `qase.qaConfigDeselections`), app.js qaUi.matrix (4808), loadQaMatrixCatalog (4883), qaMatrixRender (4992), openQaStart (5455) reloads catalog each open.
- Phase 3 (execution) NOT DONE: public/app.js:5600-5635 submit comment admits it — `selectedEnvIds.slice(0, 1)` → only the FIRST selected configuration runs, via createQaRun POST /api/sessions. No POST /api/qa-matrix-runs endpoint exists (grep: zero matches in server/). matrixApi.js routes are POST/GET /api/matrix-runs only.
- Phase 3 statuses NOT added: no QUEUED/SKIPPED/CANCELLED anywhere; MATRIX_ITEM_STATUSES = PENDING RUNNING PASSED FAILED NOT_RUN UNAVAILABLE NOT_SUPPORTED BLOCKED ERROR (matrixService.js:25). No cancel/retry routes in matrixApi.js. Orchestrator has resumeRecovery + stale sweep only.
- Phase 4 NOT DONE: public/qaMatrixResults.js does not exist (only referenced by spec .drytis/specs/qa-matrix-phase-4-results-evidence.md). No matrix_item SSE consumer in public/. Only matrix results surface = Coverage tab gap report in public/deviceMatrixView.js renderMatrixGap (714) + buildMatrixResultTables (790), data from server/matrixCoverage.js computeMatrixCoverage (coverageStateOf maps statuses → 10 user-facing states incl. Not Selected for deselected).
- Versions: environmentCatalog BROWSER_VERSIONS majors-only (chrome 140–156 etc.), one env row per version → separate checkboxes in dialog; but runtime launches ONE binary per brand (localBrowserRegistry.js single candidate path, single --version). browserVersion is emulation metadata; real version = browserSupport.detectedVersion; versionSource: 'local-registry'|'catalog' on each config.
- Honest-pass guard: matrixService.updateItem (350) requires sessionId for PASSED/FAILED.
