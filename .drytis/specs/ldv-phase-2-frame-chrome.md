# LDV Phase 2 · Dynamic device frame + browser chrome + environment card

## Goal
The live preview visually IS the active device+browser: device-shaped frame by category, browser chrome by browser key, readable environment card in the right panel replacing the narrow chip.

## Device frames (CSS, building on existing `#stage[data-device-kind]`)
Extend to `data-device-kind="phone|tablet|desktop"` (map from view-model deviceType + platform):
- **phone**: rounded bezel body, notch/dynamic-island accent, tall aspect ratio from view-model resolution (portrait) — for iPhone AND Android (Android gets distinct corner-radius/chin accent).
- **tablet**: wider bezel, landscape-capable aspect.
- **desktop**: browser-window frame (title bar + traffic lights / window controls), landscape aspect.
Aspect ratio and screen box derive from view-model `resolution` + `orientation` — no invented values; when resolution is unknown, fall back to category defaults but keep the frame honest (no fake numbers shown).

## Browser chrome
New `public/browserChrome.js` — pure module rendering a chrome bar above the screen area:
- Browser name label + brand dot/icon color per `browserKey` (safari, chrome, firefox, edge, opera, brave, duckduckgo, other).
- Nav glyphs (← → ↻), lock icon, URL from the live frame payload `url`/`title` (existing applyFrame data).
- Rendered from the view-model ONLY — label always matches executing browser.

## Right panel environment card
Replace the cramped chip line with a card (still opens Device Matrix on click / Change button):
`LIVE DEVICE` (or LIVE DESKTOP) header · device name · OS · browser + version · execution badge (● REAL DEVICE / ● VIRTUAL DEVICE / ● SIMULATED per view-model, never name-inferred) · runtime status badge (● RUNNING / ● CONNECTING… / QUEUED / COMPLETED / FAILED / DEVICE UNAVAILABLE) · Runtime: RT-XXXXXX · [Change Device].
Narrow-rail collapse behavior from #13802 preserved.

## Environment switching
Recompute view-model on `applySessionSnapshot` + SSE status/env events; frame `data-device-kind`, chrome bar, card all update with no page refresh.

## Files
- `public/index.html` (right panel card markup, stage chrome container)
- `public/styles.css` (device-kind frames, browser chrome bar, env card)
- NEW `public/browserChrome.js` + test
- `public/app.js` (render pipeline: view-model → stage attrs + chrome + card; applyFrame updates url/title)
- `public/deviceDrawer.js` (chip painting consistent with card)

## Acceptance criteria (running app)
- [ ] iPhone env → phone frame; Pixel/Android env → Android phone frame (distinct); iPad → tablet; Windows/macOS → desktop window frame.
- [ ] Safari env shows Safari chrome; changing env browser to Chrome updates chrome immediately, no refresh.
- [ ] Frame aspect ratio matches the environment's real screen resolution and orientation.
- [ ] Execution badge matches attested runtime, never the device name.
- [ ] Card shows Runtime ID when present; clicking Change opens Device Matrix.

## Tests
- browserChrome unit tests: key mapping, label/url rendering, unknown browser → 'other'.
- app-level snapshot → view-model → stage attribute wiring (extend activeRuntimeEnvironment tests).
- Existing suite green.
