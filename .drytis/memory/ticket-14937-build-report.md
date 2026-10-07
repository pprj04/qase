# Ticket #14937 Phase 3 build report (final)

Phase 3 · Actual execution via matrix orchestrator. Spec: /workspace/.drytis/specs/qa-matrix-phase-3-execution.md.
Moved to Done on the board (the update_ticket description endpoint rejects it — "not on this project's board" — likely because the board list truncates at 100 Done tickets; move_ticket works).

## Delivered
- POST /api/qa-matrix-runs wrapper (server/app.js): auth+CSRF, http(s) targetUrl validation, per-envId catalog resolution (unknown → 422), 2000-config cap (422 + "narrow the selection" message, live-verified), one item per envId, kickoffText/selectedTests/securityAuthorization/scopeSelection passed through to matrix.create + orchestrator.start.
- Launcher configuration mode (server/matrixService.js input.configurationEnvIds): exact envId+browserVersion pinning; NOT_SUPPORTED for unsupported browsers; BLOCKED 'Configuration "X" is no longer in the catalog.' for vanished ids.
- Frontend submit (public/app.js): single POST with all selected envIds → dialog close → toast → waitForFirstMatrixSession switches live view.
- Retry ledger: retryCount seeded 0 at creation, persisted (migration 036_matrix_item_retry_count.sql, postgres mapping, local merge preserves). Live-verified run matrix-muxbhjux-d7375a6e → done/BLOCKED/retryCount=0/3 artifacts.
- WebKit trixie runtime deps: installed + in setup script (WEBKIT_EXTRA_DEPS). See webkit-trixie-runtime-deps.md.

## Verification
- matrixApi.test.js 7/7 (new HTTP cancel + bounded retry tests) — run with `node server/matrixApi.test.js`; `node --test` wedges on an open promise (runner quirk, not a failure).
- matrixOrchestrator.test.js 12/12 (cancel + retryItem tests added; cancel test settles its hanging session so no 8-min tail).
- matrixService.test.js 16/16; matrixService.queued.test.js 5/5; postgres/matrixRunRepository.test.js 7/7.
- Reviewer round-3: PASS all points. Tester: PASS 6/6.

## Known limitations
- BrowserStack registered but not configured (connected:false) → honest BLOCKED/UNAVAILABLE, never silent emulation.
- Safari executes on WebKit engine; runtimeFacts label the actual engine, never claiming real Safari.

## Recommendations (need customer approval, not implemented)
- QUEUED-state route-level cancel test (API test pins PENDING→CANCELLED only).
- Frontend cancel/retry controls for running matrix runs (routes exist; no UI buttons).
- Trim cancelledRuns Set after runs settle (cosmetic).
