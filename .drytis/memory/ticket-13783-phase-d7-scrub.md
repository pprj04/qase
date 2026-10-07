# #13783 D7 — provider-name scrub shipped; media gating verified pre-existing

## What shipped
User-facing BrowserStack neutralization: index.html (3 strings: env dialog subtitle, advanced QA picker label + "Emulate locally (no remote environment)" option), app.js (pill title → 'remote environment runtime', env table cell → 'Remote runtime', env detail fallback browserstackCapabilities ?? runtimeCapabilities), server/report.js + reportPdf.js (provider label map {browserstack: 'remote environment runtime', local: 'local runtime'} in environmentLine AND Execution rows, markdown + PDF). Flipped 2 test assertions in qaTools.test.js / reportPdf.test.js that pinned the old leaky \(browserstack\) output. NEW server/providerScrub.test.js (2 tests: line sweep of 7 user-facing files skipping comments + raw-key lines; label-map pinning). Suite 1156/1136/0/20.

## Verified pre-existing (NOT rebuilt)
- probeMicrophone: 5s timeout race → rejected; RMS signalDetected >0.0001; tracksStopped verified in finally. browser_media tool whitelists actions; bridge refuses non-synthetic browsers + prompt-permission probes. installMediaObserver records granted/rejected + track state as evidence; committed via runStore.commit.
- Attestation gating: REAL_DEVICE requires att.device_id && att.capabilities_verified; capabilities_verified null for non-REAL.
- setMicrophonePermission via CDP Browser.setPermission with persistent browser-context session (mic only — matches spec).

## WARNs (documented, not fixed)
1. browser_media is mic-scoped by design; camera/screen-share have NO probe tools — capability truth exposed per-platform via deviceDrawer/deviceRuntimeProfiles ('limited' → recorded NOT SUPPORTED never PASS). Spec literal reading only 1/3 at tool level — accepted as honest limitation.
2. Server-internal residuals: deviceRuntime/browserstackRuntimeProvider.js:24 unavailableReason 'BrowserStack credentials not configured…' and :67 'BrowserStack remote device' fallback — can surface in runtime-manager diagnostics; excluded from sweep deliberately. Future pass candidate.
3. Raw key executionProvider:'browserstack' stays in API (contract unchanged, agreed interpretation: user-facing text only).
4. browserMedia.integration.test.js skip-gated behind QASE_RUN_BROWSER_TESTS=1.

## Remaining stale Open tickets (next in board order)
- #13784/#13785 Phase D8 acceptance validation & regression — DUPLICATE PAIR of each other; #13785 should close as dup of #13784 (or whichever is real). D8 spec = .drytis/specs/device-d8-*.md; note scripts/test-acceptance.mjs has STALE selectors post-M7 (#14474 WARN: T7/T8 wait on #dp-cards .dp-card/.dp-select-btn which never render now) — likely the real D8 work.
- #14076 Exec Panel Phase 2 Choose Device form [high] — dup of done #14075?
- #14103 [urgent] remove CHOOSE DEVICE strip — DONE via #14102/#14132; close as dup.
- #14120 collapsible CURRENT TEST DEVICE card — card REMOVED by #14132; likely obsolete; verify then close.
