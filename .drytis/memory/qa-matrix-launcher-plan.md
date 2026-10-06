# QA Matrix launcher plan (2026-10-06)

Replacing Start QA's three-engine checklist with full device/browser matrix. Specs in
`.drytis/specs/qa-matrix-phase-{1..5}-*.md`.

Key facts from research:
- Start QA dialog: `#qa-start` in public/index.html has a DUPLICATED qa-engine-fieldset (three-engine Chromium/Firefox/WebKit) — both blocks must be replaced with one matrix fieldset. Wiring in public/app.js: qaUi (~line 4700), selectedQaEngines/syncEngineAvailability, submit handler ~5135–5216 fans out POST /api/sessions per engine with coreFlowsOnly.
- Server-side path to reuse: POST /api/matrix-runs (matrixApi.js) + matrixOrchestrator.js (worker pool, QASE_MATRIX_PARALLEL 1–4 default 1, SSE matrix_item events, resumeRecovery). NO public/ consumer yet. Missing: cancel, retry, QUEUED/SKIPPED/CANCELLED statuses.
- Existing item statuses: PENDING RUNNING PASSED FAILED NOT_RUN UNAVAILABLE NOT_SUPPORTED BLOCKED ERROR. Run statuses: pending/running/done/error/interrupted.
- Catalog: all 7 browser families × 5 platforms exist in environmentCatalog.js (DDG versions 1/2/3, statically not_supported; Safari iOS/iPadOS/macOS only). ~175 devices. Apple rows LACK manufacturer field (fix planned); orientation hardcoded portrait/null.
- browserSupportResolution: statuses supported/engine_equivalent/not_supported with honest reasons; local branded binaries chrome/brave/opera/edge launch-verified at boot (server/index.js probe), Firefox native bundle, WebKit GTK under Xvfb, DDG no execution channel exists.
- BrowserStack catalog provider registered but connected:false — BROWSERSTACK_USERNAME/ACCESS_KEY env keys exist but unset (provider setup still required for real iOS/Android devices).
- runtimeFacts on session record the ACTUAL launched browser (launchedEngineId, brandedBinary, UA) — honesty plumbing complete; matrix items already carry executionLevel/provider/runtimeFacts + artifactRefs.

Decision: extend matrix orchestrator (cancel/retry/new statuses) rather than build a new queue; new GET /api/qa-configurations endpoint for the launcher; new POST /api/qa-matrix-runs wrapper for QA start.
