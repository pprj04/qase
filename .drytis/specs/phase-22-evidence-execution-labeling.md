# Phase 22 · Evidence, session artifacts + reports carrying execution level

## Goal
Every screenshot/video/log/artifact carries environment + execution-level
metadata; run records, findings evidence, report.md/PDF and the run list all
display REAL DEVICE / VIRTUALIZED / SIMULATED prominently. No artifact can be
mistaken for real-device evidence unless it is.

## Files
- `server/artifactStore.js` (new) — persisted artifacts (base64 frames
  promoted to stored screenshots on demand, video via Playwright
  recordVideo, console logs) under `.qase/artifacts/<runId>/`; metadata
  sidecar json per artifact: { artifactId, type, device, os, osVersion,
  browser, browserVersion, executionLevel, capturedAt, sessionId }.
- `server/app.js` — GET /api/sessions/:id/artifacts, GET
  /api/sessions/:id/artifacts/:artifactId (serves bytes + metadata header)
- `server/runRepository.js` / `store.js` — persist artifact index on the
  run row; findings' evidence can reference artifact ids
- `server/report.js` / `reportPdf.js` — report header gains Execution block:
  Device / OS / Browser / **Execution: SIMULATED|VIRTUALIZED|REAL DEVICE**
  / permission scenario; per-finding evidence list includes artifact ids
- `public/app.js` — run list pill + run-env-block gain a level badge
  (color-coded); Findings render attached artifacts; Browser Preview keeps
  working as today (frames unchanged)

## Acceptance criteria
- [ ] A simulated run's report reads "Execution: SIMULATED" in the header;
      a real-device run (when a provider attests) reads "Execution: REAL
      DEVICE" — and the label comes from recorded runtime facts, not from
      the requested level.
- [ ] Screenshots captured during a run are retrievable via API with full
      environment metadata; artifacts survive run completion.
- [ ] Findings can attach artifact references; report lists them.
- [ ] Run list shows the level badge for every environment-linked run.
- [ ] Backward compat: old runs (no artifacts, no level) render without
      the badge and without errors.
- [ ] npm test green; unit tests for artifact metadata stamping.

## Edge cases
- Artifact pruning on run delete must not orphan metadata.
- Video capture on huge runs — cap duration/size; degrade to screenshots.
- Postgres vs local store parity for the artifact index.
