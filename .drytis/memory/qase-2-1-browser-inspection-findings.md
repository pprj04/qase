# QASE-2.1 preview (qase-2-1-cvtryq.drytis.dev) browser inspection — 2026-09-29

Headless Playwright, viewport 1440x900. Chromium-1243 (headless shell, fresh install) SEGFAULTS on launch; chromium-1234 at /home/coder/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome works — pass `executablePath`.

## Auth
- demo@qase.dev / demo1234 → POST /api/auth/login returns 401 `{"error":"Email or password is incorrect."}` on this preview (those creds only work on prod qase.drytis.dev /demo).
- Workaround: register new account via #auth-switch. Password must be ≥12 chars (client-side rule, silent otherwise).

## Layout bugs (confirmed via JS bounding boxes)
1. `#quick-actions` strip is pushed BELOW the viewport: `.cli-theme` parent is 949px tall vs 900px viewport → document scrolls vertically (scrollHeight 949). Strip renders at y=900, fully invisible without scrolling. All 6 qa-* buttons + #qa-preset select off-screen.
2. `#device-chip-change` ("Change") overflows right edge: x=1395 w=66 → right=1461, 21px past 1440 viewport → document horizontal scrollWidth 1461. Needs horizontal scroll to be clickable.
3. `.device-chip` intentionally sits inside `.feature-dock` (overlap 40x107 is by design, not a bug).
4. Transcript panel has NO `.transcript-panel` selector — it's `#transcript.transcript` at x=242 y=104 w=490 h=324, rendered fine.

## Functional
- `<dialog id="qa-start">` ("Start QA run") is OPEN ~6s after login and intercepts ALL pointer events (native dialog) — blocks clicking anything incl. #device-chip-change. Closing it (`d.close()`) unblocks interaction.
- Device drawer after click: opens correctly as side panel x=1000 w=440 h=900 (fits viewport).

## Console
- Only expected 401s on /api/auth/me + /api/environments before login; zero pageerror; no JS runtime errors after login.
