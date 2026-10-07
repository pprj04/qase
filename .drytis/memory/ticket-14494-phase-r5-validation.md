# Phase R5 (#14494) — final validation sweep & honesty report — DONE

## What shipped
- scripts/test-acceptance.mjs: T19 (API honesty sweep: every /api/device-runtime/devices board row OFFLINE + unavailableReason; no env claims AVAILABLE without a real runtime — 41,374 rows / 38,458 envs) and T20 (matrix rows render 'REAL DEVICE UNAVAILABLE', never bare AVAILABLE). 24/24 checks PASS.
- public/matrixColumns.js: unavailable rows are now SELECTABLE (aria-disabled + click guard removed). R1 honesty blocks EXECUTION, not inspection — block happens at run start (fallback dialog from fallbackOptionsFor + server selectForRun not_available guard, R3).
- Selection honesty fix (R5): public/activeTestEnvironment.js resolveForEnvironment now carries `unavailableReason`; public/activeRuntimeEnvironment.js viewForSelection maps OFFLINE/UNAVAILABLE/NOT_EXECUTABLE availability → runtimeStatus 'device_unavailable' (was hardcoded 'queued', so the unavailable panel never showed for an idle selection). public/app.js matrix onSelectVersion attaches boardByEnvId unavailableReason onto env before setSelection. Verified live: selecting an unavailable row renders the DEVICE/BROWSER UNAVAILABLE panel with the reason text.
- Gotchas hit (do not repeat): (1) `#nav-device-matrix` opens the OLD #device-matrix catalog dialog, NOT the matrix picker — the picker opens via #ldv-change-device / #ldv-choose-device; (2) locator.waitForSelector defaults to visible-state and the picker tree's first nodes may sit in collapsed/hidden categories — use state:'attached' + DOM-level clicks in acceptance scripts; (3) object-literal property key followed by `const` inside a frozen object literal = SyntaxError (labeled statement) — keep computed expressions inline.
- Validators: validate-matrix.mjs ALL CHECKS PASSED; theme-validation.mjs RESULT: PASS; suite 1161/0/20.

## Board state after R5
All R-phase tickets (#14490–#14494) Done. Board 0 Open / ~105 Done. NOTHING PUBLISHED (NIHARIKA uncommitted work is checkpointed by git_manager). Preview: https://qase-2-1-cvtryq.drytis.dev/ (200).
