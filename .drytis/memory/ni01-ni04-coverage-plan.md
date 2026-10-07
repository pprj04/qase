# NI01–NI04 device/browser coverage plan (Oct 2026)

Plan for QASE-2.1 device & browser coverage NI01–NI04. Specs at /workspace/.drytis/specs/ni0*.md. Key grounding facts from researcher (2026-10-05):

- **No MANOJ default-selection logic exists** in code. "MANOJ" is only a branch/teammate name. The user asked to "preserve MANOJ defaults" — interpreted as: preserve existing default-selection behavior (picker default environment in localStorage `qase.activeTestEnvironment`, SQA core profiles default-checked) and update only underlying profile data. Stated to user in plan.
- No profileId scheme like `iphone17promax-ios26-safari26` exists; current scheme is ENV-ID (`buildEnvId` in server/environmentCatalog.js:652). Plan adds stable lowercase profileId aliases for coverage reporting.
- DuckDuckGo resolution: NO provider can run it (no Playwright build, not on BrowserStack) → permanently NOT SUPPORTED, visible in catalog, reason surfaced. Opera/Brave: engine-equivalent Chromium execution only, must be labeled as such.
- Bulk run today is a client-side loop (bulkRunView.js); NI02 replaces with server-side matrix run (qa_matrix_runs + qa_matrix_run_items, additive migration, both stores).
- Honest statuses: PASSED | FAILED | NOT RUN | UNAVAILABLE | NOT SUPPORTED | BLOCKED | ERROR — persisted per item, never derived from absence.
- Known-defect fixtures: new server/defectFixtures.js extending /demo fixture pattern (demoSecurityFixtures.js).
- Coverage: extend server/coverageService.js + deviceMatrixView.js coverage tab, no new dashboard.
