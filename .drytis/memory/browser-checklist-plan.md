# Browser checklist expansion plan (2026-10-06, B1–B4)

Request: extend "Test your website" checklist to 7 families with runner-real versions,
default full selection, independent per-browser execution, and the explicit status set
(PASSED/FAILED/RUNNING/QUEUED/NOT RUN/NOT SUPPORTED/UNAVAILABLE/ERROR).

CRITICAL recon finding (memory qa-matrix-gap-recon-15013.md + researcher report):
QA-matrix phases 3–5 (#14935–#14943 era) were NEVER BUILT. What exists:
- Phase 1 built: GET /api/qa-configurations (server/qaConfigurations.js).
- Phase 2 built: qa-matrix-fieldset in #qa-start dialog (index.html:769–790), families
  checklist + device/version tree, filters, deselection persistence
  (qase.qaConfigDeselections), Start gating.
- Phase 3 NOT built: no POST /api/qa-matrix-runs; app.js submit (5600–5635) runs
  selectedEnvIds.slice(0,1) via POST /api/sessions engine:'chromium' — silently drops
  everything but the first config. TEST ON block (index.html:746–768,
  selectedEnvironmentForRun app.js:879) is a competing selector that actually drives runs.
- Phase 4 NOT built: no qaMatrixResults.js, no SSE matrix_item consumer in public/.
- Existing reusable: matrixService statuses (PENDING RUNNING PASSED FAILED NOT_RUN
  UNAVAILABLE NOT_SUPPORTED BLOCKED ERROR), honest-pass guard matrixService.js:350–368,
  deselection→NOT_RUN at matrixService.js:96–100, categoryOf device grouping,
  channelForVersion (Latest/Previous channels) in environmentCatalog.js:132–145.
- Version realism gap: localBrowserRegistry probes ONE binary per brand; selecting a
  different major is emulation-only today. Multi-version real execution needs multi-binary
  probing + versionMatch honesty.

Specs: .drytis/specs/browser-checklist-phase-b{1..4}-*.md (B1 execution wiring, B2 results
board/status set, B3 runner-real versions, B4 validation/coverage statement).
