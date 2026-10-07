# Ticket #14075 (Choose Device form layout) — browser test findings 2026-10-01

Login as accounts[0] worked. Tested at 1920x1080 and 1024x768, right panel expanded.

## Verdict per check
- F-A PASS: .cd-form = grid, 2x2 (Device/OS row 1, Browser/Execution row 2), 4 labels, Device select has optgroups APPLE(39)/ANDROID(37)/WINDOWS(3). Clean at 1920.
- F-B PASS: Device → Pixel 8 repopulates OS (Android 14/15), Browser (Chrome 138–141), summary + CURRENT TEST DEVICE card + Start QA Run dialog "TEST ON Pixel 8 · Android 15 · Chrome 138" all update.
- F-C **FAIL — Browser change discards the user's OS selection**: on iPhone 11, set OS=17.0 (summary "iOS 17.0 · Chrome 138"), then pick Browser="Safari 17.0" → selection silently becomes "iPhone 11 · iOS 26.0 · Safari 26.0". Root cause: `cdFormOverrideChange` (public/app.js:946, :878) calls `resolveDeviceEnvironment({device, browser})` WITHOUT carrying the current osVersion, so rankEnvironments' newest-OS preference wins (devicePicker.js:112-125, 33-58). OS→Browser cascade itself is correct (Safari 17.0 listed only under iOS 17.0).
- F-D PASS (catalog has no attested/REAL devices): Execution select always offers exactly [SIMULATED], no REAL DEVICE; single-option selects visibly disabled (opacity .55, cursor default, aria disabled) — exec, and OS/Browser when only one option.
- F-E PASS: "Browse all devices" opens search + platform chips (All/Apple/Android/Windows) + type chips (All/Phone/Tablet/Desktop) + 79 grouped cards (APPLE/ANDROID/WINDOWS). Search "pixel 9" → Pixel 9, Pixel 9 Pro. Selecting "Windows Desktop" card updates form + summary + card. List scrolls internally (overflow hidden auto, max-height 300px); document doesn't scroll.
- F-F **FAIL at 1024x768**: `.cd-form` stays `repeat(3, minmax(...))`-style 3-col grid (191px×3 = 597px) but the cd-body/panel is ~625px wide and the VIEWPORT is 1024 — the panel itself sits at x=663..963 but cd-body/form overflow to x=1289, so cd-os (right edge 1072) and cd-browser (right edge 1275) are clipped outside the viewer panel edge. No horizontal PAGE overflow (sw=cw=1024) because .panel.viewer overflow clips it, but controls are unreachable/cut off. At 1920x1080 F-F passes (sw=cw=1920, selects inside panel).
- Collapsed header: 46px < 60px, summary one line. PASS.
- Console: 1 error "An invalid form control with name='targetUrl' is not focusable" — fired when clicking the "Start QA run" button inside the left nav (start-mode button) rather than the dialog; the proper "Start standard QA run" button opens the dialog fine. Likely form.reportValidity() on a hidden input; pre-existing? not in #14074 test notes.

## Screenshots
.playwright-mcp/cd-expanded-1920.png, cd-expanded-1024.png (selects clipped at 1024).

RESULT: FAIL (2 of 6) — F-C OS-discard bug; F-F 1024 select clipping.
