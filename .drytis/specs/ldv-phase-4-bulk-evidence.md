# LDV Phase 4 · Bulk-run live switching + evidence headers

## Goal
One live preview, many runs: the preview follows the currently active bulk run; every piece of evidence carries its device/browser provenance in the UI.

## Bulk-run switching (AC9)
- Hook `batchTracker.onTick` (public/bulkProgress.js): determine the active run = first session in status running/starting (fallback: most recent non-done); when it changes, `selectSession(activeRunId)` so the live preview (frame, device frame, chrome, card, runtime ID) switches to that run's environment automatically — Pixel+Chrome becomes the shown context when RUN 1 (iPhone+Safari) finishes and RUN 2 starts.
- Bulk progress rows already show per-run env + execution level; add an "active" marker on the row currently shown in the live preview. Never mix two environments in one preview.

## Evidence headers (D3 sidecars → UI)
Artifact sidecars already carry device, os, osVersion, browser, browserVersion, viewport, executionLevel, runtimeSessionId, evidenceHeader (server/artifactStore.js). Surface it:
- In the Report tab, an Evidence section listing artifacts with their provenance header (Evidence #N · device · OS · browser version · orientation · REAL/VIRTUAL/SIMULATED · RT-ID · timestamp).
- Where findings/evidence links appear (SQA tab lists), attach the same compact provenance line when artifact metadata is fetchable via the existing artifacts API.
- Read-only; no artifact generation changes.

## Files
- `public/app.js` (batchTracker onTick switching, evidence rendering in report tab)
- `public/bulkProgress.js` (expose active-run resolution helper; keep tests green)
- `public/styles.css` (active row marker, evidence card)

## Acceptance criteria (running app)
- [ ] During a multi-environment bulk run the live preview always shows the currently executing run's exact device/browser, switching automatically as runs advance.
- [ ] The active row is marked in bulk progress; no two environments are ever blended in one preview.
- [ ] Report evidence shows per-artifact device/OS/browser/orientation/execution-level/runtime provenance.
- [ ] Single (non-bulk) run behavior unchanged.

## Tests
- bulkProgress helper unit tests (active-run pick: running > most recent).
- Report evidence rendering test with fixture sidecar meta (pure render function).
- Existing suite green.

## Notes / risks
- Orientation switch (AC6): runtime viewport orientation is controlled by env config (orientationScenario) — the frame uses the view-model orientation; actual device rotation capability is bounded by what the runtime provides; do not fake rotation.
- No backend/API changes anywhere in this feature; evidence metadata comes from existing artifact endpoints.
