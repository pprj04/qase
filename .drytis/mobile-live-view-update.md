# Mobile Live View Update

**Date:** 2026-08-14 · **Scope:** Focused UI/live-execution improvement (no new
architecture phase). Autonomous execution engine untouched except one additive
seam for real device emulation. BrowserStack path untouched.

## Current behavior (before this change)

The live execution panel styled **every** viewport identically: the SDK's
browser automation service hard-coded a desktop context
(`browser.newContext({ viewport: 1440×900, acceptDownloads: true })`), with no
device, user-agent, DPR, or touch options anywhere in the agent execution path.
"Mobile testing" meant the agent calling the `set_viewport` tool
(375×812 / 768×1024 presets) inside that desktop context, and the dashboard
rendered the resulting frames in the same rectangular desktop-style box
(`.stage-inner`, 11px radius). There was no device identity (name / OS /
browser / UA) anywhere on the session — QASE classified "mobile" purely by
viewport dimensions, so the live view "behaved mainly like a resized browser
frame" because that is literally all it was.

## Root cause

1. The @cleanslate/sdk constructs its browser context lazily with a fixed
   desktop viewport; no API for device emulation.
2. Sessions carried no device request/identity fields, so even a
   mission-level device preference had nowhere to live.
3. The frontend derived nothing from the frame viewport — one style for all.

## Changes made

### Backend — REAL device execution (server)

- **`server/deviceContext.js` (new, ~150 lines)** — maps a device request
  ("Pixel 8", "iPhone 15 Pro", `{ device: 'iPad Pro 11' }`) to the REAL
  Playwright device registry entry (`playwright-core/devices`): user agent,
  viewport, deviceScaleFactor, isMobile, hasTouch. Unknown devices resolve to
  `null` → desktop (never a fake fallback). `describeDevice()` produces the
  human label. Engine honesty: `engineRequested` (webkit for iOS) vs `engine`
  (chromium actually runs locally — no WebKit binaries installed), exposed as
  `engineEmulated`.
- **`server/agent.js`** — after the browser bridge attaches, if the session has
  a device request, `service.registerPage` is wrapped once: the first page
  registration closes the desktop context and recreates it with the device
  descriptor, re-navigating to the remembered URL. Desktop sessions never take
  this path (their context is built exactly as before). Failures fall back to
  the desktop context, never killing the mission. Emits a `device` SSE event
  and stores `session.device`.
- **`server/store.js`** — `createSession(title, projectId, { deviceRequest })`
  accepts the request; session carries `deviceRequest` + resolved `device`
  (persisted → survives refresh).
- **`server/index.js`** — all four mission-start paths (`POST /api/v1/missions`
  auto-start, `POST /api/v1/missions/:id/start`, iterate, revalidate) pass
  `mission.constraints.device` into the session. `GET /api/sessions/:id` now
  returns `deviceRequest` + `device`. Mission creation via API/UI accepts
  `constraints.device` end-to-end.

### Frontend — device live view (public)

- **`public/deviceClassify.js` (new)** — pure `classifyViewport()` (shared with
  tests): phone = portrait ≤500px wide; tablet = portrait ≤1100px wide +
  ≥700px tall, or landscape tablet-proportioned (≥600px tall, ≤900px tall,
  ≤1300px wide); everything else desktop. A squashed desktop window
  (900×400) stays desktop — viewport width alone never means mobile.
- **`public/index.html`** — Device selector in the mission context panel
  (Desktop default; iPhones/Pixels/Galaxy phones; iPad Pro 11 / iPad Mini /
  Nexus 7 tablets) feeding `constraints.device`; `#device-strip` element under
  the live view URL bar.
- **`public/app.js`** — SSE `device` event listener; `renderDeviceStrip()`
  (Device/OS/Browser/Viewport/Mode — only fields actually available, hidden
  for desktop); `applyDeviceFrameClass()` driven by the REAL frame viewport on
  every frame; hydration of `session.device`/`deviceRequest` on load AND
  refresh; `state.viewport` reset on session switch (leak fix); composer sends
  `constraints.device` with the mission.
- **`public/styles.css`** — phone bezel (30px radius, notch pill + home-indicator
  line via pseudo-elements, padding around the screenshot), tablet bezel
  (22px radius, camera dot), landscape variant, device info strip, green
  MOBILE/TABLET pill. Desktop view unchanged.

## Devices tested

| Device | Registry viewport | Live frame viewport | Result |
| --- | --- | --- | --- |
| Pixel 8 (phone, Android 14, Chrome) | 412×839 | 412×839 ✓ | Mission completed, 3 findings, evidence captured |
| iPad Pro 11 (tablet, Safari) | 834×1194 | 834×1194 ✓ | Mission completed, device strip "TABLET" verified in browser |
| Desktop (default) | 1440×900 | 1440×900 ✓ | Unchanged — no strip, no bezel, plain frame |

Real UA / DPR verified live: Pixel 8 context carried
`Mozilla/5.0 (Linux; Android 14; Pixel 8) … Chrome/151 Mobile Safari/537.36`,
DPR 2.625; iPad natural screenshot 1668×2388 = exact 2× DPR of 834×1194.

## Desktop regression

- Desktop sessions (Phase 9.1 benchmarks, revalidation runs) still render
  1440×900 frames, `device: null`, no strip, no bezel classes — verified via
  API (viewport 1440×900) and in-browser by the tester (desktop run:
  strip hidden, plain 11px-radius frame, zero inset).
- Full test suite: **789 tests / 787 pass / 2 fail** — the 2 failures are the
  pre-existing RL-1 (sessions.json 88MB) and RL-2 (1240 sessions > 200) known
  issues, unchanged by this work. No new failures. New suite
  `tests/device-context.test.js` (9 tests) covers device resolution, alias
  casing, tablet classification, desktop/no-op paths, unknown-device null,
  context option mapping, labels, viewport classification thresholds, and
  `createSession` deviceRequest plumbing.

## Mobile E2E result

1. Mission starts ✓ (POST /api/v1/missions with `constraints.device: "Pixel 8"`)
2. Correct device selected ✓ (session.device = Pixel 8, UA applied, DPR 2.625)
3. Live execution shows the device frame ✓ (browser-verified `device-phone` class)
4. Actual page visible inside it ✓ (live screenshots at 412×839 portrait)
5. Actions continue to work ✓ (25 captured steps, clicks/fills completed)
6. Evidence captured ✓ (step_outcome evidence items on the mission)
7. Findings still work ✓ (3 findings incl. critical; qualityScore 15, verdict fail)
8. Refresh does not break the session ✓ (device strip + bezel + final screenshot
   identical after full page reload — hydrates from persisted `session.device`)
9. No fake/mock device data ✓ (all values from the real Playwright registry +
   the real context; unknown devices resolve to desktop, never invented)

## BrowserStack

Untouched. The BrowserStack execution path (replay tier, CDP connect with
`browserstackEnabled` + user + key, local-Chromium fallback) was not modified.
Device emulation applies to the agent's live execution path only; when
BrowserStack is enabled the existing path is preserved (that tier creates its
own contexts with explicit viewports).

## Remaining limitations

- **iOS engine emulation:** Playwright's registry pairs iPhones/iPads with
  WebKit; this container ships Chromium only. iOS devices therefore run a
  Chromium engine with the REAL iOS device characteristics (UA, viewport,
  DPR 3, touch) — recorded honestly as `engineEmulated: true`. Android
  devices (Pixel/Galaxy/Nexus) run their native engine.
- **Orientation** follows the real viewport (landscape devices render a
  landscape frame). No explicit orientation-change signal exists in the
  execution path, so orientation updates when the real frame viewport changes
  (e.g. via `set_viewport`) — no orientation state was invented.
- **Device choice is mission-level:** the mission composer's Device selector
  fixes the device for the whole run. Mid-run device switching via chat is not
  exposed (the agent's `set_viewport` tool still resizes within the device
  context for responsive checks).
- **Known issue (pre-existing):** RL-1/RL-2 resource-lifecycle test failures
  (sessions.json size / session count) — unchanged, unrelated.
- **Tester incident (resolved):** during the first browser test pass, a
  faulty test script deleted ~16 sessions including the two original device
  E2E sessions. The phone E2E was re-run fresh (session d8647632, mission
  bfd8842d, completed) and re-verified; the tablet run completed before
  deletion (mission b6c6961c, status completed, strip verified in-browser
  while live). Historical desktop/phase missions were unaffected.
