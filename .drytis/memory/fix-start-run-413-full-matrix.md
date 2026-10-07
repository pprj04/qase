# Fix: "Start QA run" 413 with default full-matrix selection (#14942)

## Symptom
User clicks Start QA run with the default selection (all 37,244 available
configurations) → nothing starts; form error "Request body is too large."

## Root cause (two layers)
1. **Server**: global `express.json({ limit: '1mb' })` (server/app.js) rejected
   the POST before the route ran. 37k real envIds ≈ 1.6–2MB JSON → bare 413.
   The route's own actionable 2,000-config cap 422 (POST /api/qa-matrix-runs,
   MAX_MATRIX_CONFIGURATIONS) was never reached.
2. **Client**: `syncQaSubmitState()` (public/app.js) gated Start on URL +
   ≥1 configuration but NOT on the 2,000 cap, so the launcher happily POSTed
   an oversized payload.

## Fix (shipped)
- server/app.js: route-scoped `app.use('/api/qa-matrix-runs',
  express.json({ limit: '8mb' }))` mounted BEFORE the global 1mb parser →
  oversized selections now get the actionable 422 cap message (verified up to
  8.5MB payloads).
- public/qaConfigMatrix.js: `export const MAX_RUN_CONFIGURATIONS = 2000`;
  `canStartRun()` now enforces the cap.
- public/app.js: syncQaSubmitState disables Start over cap; submit handler
  returns the same actionable message; matrix summary line appends
  "· over the 2,000-configuration run limit — narrow the selection to start".

## Narrowing UX (existing, verified)
Search (e.g. "iPhone 15 Pro") then CLICK the device row → device scope
(#15163) scopes the run to that device (~222 configs), Start enables, POST
201, results board opens and renders rows.

## Verification
Browser E2E via Playwright (preview URL): default 37k → Start disabled +
summary over-cap note; scoped device → 201 + results dialog. Suites:
matrixApi 7/7, app.test.js 36/36, qaConfigMatrix 27/27.

## Note — matrixApi.test flake
`node --test server/matrixApi.test.js` intermittently ends with
'Promise resolution is still pending' / spawn EAGAIN — this is the known
PID-exhaustion zombie leak (incident-pid-exhaustion-zombies.md), not a test
regression. On a healthy container the suite passes 7/7 (~91s). If a suite
run collapses instantly with spawn EAGAIN, restart the container and re-run.
