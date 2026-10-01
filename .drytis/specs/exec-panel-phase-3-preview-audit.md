# Exec Panel Phase 3 · Device-shaped preview, one source & full-screen audit

## Goal
(a) The preview (#stage) visually reflects the selected device category and browser
(browser chrome from runtime facts — mostly exists from LDV #13858; verify in the new
right-panel position, fix anything the relocation broke). (b) One device selection
source end-to-end re-verified. (c) Full execution-screen audit for overflow, clipping,
hidden content, broken scrolling, and responsive issues — fix secondary findings.

## Scope
- #stage[data-device-kind] bezel CSS (phone/tablet/desktop frames) renders correctly
  inside the narrower right column; stage-inner letterboxing keeps the frame visible.
- Browser chrome (chromeViewModel) still applies; LIVE_VIEW indicator visible.
- Empty state when no session (already #stage-empty) — verify it fits.
- Right-panel device info (env card) shows ONLY the currently selected device;
  Change Device → same selector; no second state (activeTestEnvStore everywhere —
  already true; assert via test).
- Audit: run the app at all six resolutions; check every dialog opens/positions
  correctly with the new layout; check stacked ≤1023 behavior; console error-free.

## Acceptance criteria
- [ ] Selecting iPhone → phone-shaped frame; iPad → tablet; Android phone → phone
      frame; Windows/macOS → desktop browser chrome. Browser reflected (Safari/
      Chrome/Firefox/Edge/Opera/Brave/DuckDuckGo).
- [ ] Preview header shows device, OS, browser, execution status.
- [ ] Every device entry point (Choose Device, right-panel Change, QA/SQA/Founder
      dialogs, test cases, bulk runs) converges on one state; selection survives
      tab switches and reload.
- [ ] Zero console errors; no clipped/hidden content found in the audit sweep;
      findings fixed, not hidden.

## Tests
- Acceptance suite: extend with device-kind assertions (data-device-kind matches
  selection) and a reload-persistence check.
- Responsive suite unchanged (Phase 1 updated it) — must still PASS.

## Edge cases
- Very long device names in the preview header (ellipsis, not clip).
- Orientation change (portrait/landscape) still swaps frame dims.
- Session completion keeps final device/browser + frame (LDV #13859) — re-verify.
