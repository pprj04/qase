# Ticket #14077 (Phase 3: device-shaped preview + full-screen audit) — browser test

Preview: https://qase-2-1-cvtryq.drytis.dev/, accounts[0] tester@qase.dev. Viewports 1920x1080 / 1366x768 / 1024x768.

## P-A device frames — PASS
Stage `data-device-kind` + visual bezel (screenshots in .playwright-mcp/):
- iPhone 17 Pro Max → kind=phone, phone bezel with notch ✓
- iPad Pro 11-inch → kind=tablet, tablet bezel ✓
- Windows Desktop → kind=desktop, no bezel ✓
- Pixel 9 Pro → kind=phone ✓
Header (#ldv-device), CURRENT TEST DEVICE card, #cd-summary all updated instantly on each change.

## P-B header content — PASS (idle) / INCONCLUSIVE (running)
- `#live-device-view-head` title = "Live device view — iPhone 17 Pro Max · iOS 26.0 · Safari 26.0 · SIMULATED" — exact 4-part format ✓
- #chrome-brand: `.browser-chrome` is hidden at idle (honest idle state), BUT brand text stays "Chrome" while Safari is selected — stale text in hidden element. Brand-while-session-running untestable: no live session possible (all catalog envs SIMULATED, no stream).

## P-C persistence — PASS
Reload: all three surfaces still "iPhone 17 Pro Max · iOS 26.0 · Safari 26.0". Tabs Activity→Plan→Report: unchanged, consistent.

## P-D full audit — PASS
- All 3 resolutions: pageScrollX/Y = 0, no panel overlaps (runs/chat/viewer), only "offender" is the intentionally off-screen .skip-link; stage/tabs/composer/choose-device all within viewport.
- Dialogs: Start QA run, Start SQA assessment, Start founder review, Test cases, Launch bulk runs, Settings ("Model endpoint"), Device & Environment Matrix (via Settings → Open Device Management) — all open, all within viewport, all close via Escape. Device Matrix closes to Settings; second Escape closes Settings (stacked, expected).
- Console after login: zero errors (the 5 401s are the known pre-auth family).

## P-E empty state — PASS with note
- Empty prompt "SELECT A DEVICE" fits inside #stage bounds at 1024x768 (empty rect inside stage rect), neutral frame, no clipping.
- NOTE (bug, minor): after clicking "Clear" (#dd-clear-selection), #cd-summary and ldv card correctly reset to "No device selected"/"—", but #ldv-device header and #stage data-device-label RETAIN the stale device name ("iPhone 17 Pro") — header/stage do not reset on clear.

## Env incidents (not app bugs under test)
- ~08:23 the session was invalidated server-side (likely the known in-memory login throttle): 5 authed endpoints 401'd and the app redirected to the sign-in page mid-test. Re-login succeeded; SQA/Founder/TestCases/Bulk/Settings/DeviceMgmt retested after.
- Stale-ref click hazard: clicking a cached ref after page re-render hit "Sign out" instead of "Test cases". Use role= name selectors.
