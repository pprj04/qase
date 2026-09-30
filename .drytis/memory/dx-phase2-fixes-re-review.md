# DX Phase 2 fixes re-review (ticket #13906) — RESULT: PASS

Previous FAIL (missing empty-state markup) resolved. Verified:

1. **Empty-state card markup** — `#ldv-env-card-empty` now in index.html L260–266 (kicker + `.ldv-env-prompt` "SELECT A DEVICE" + `#ldv-choose-device` "Choose device" button, `hidden` default). Served live at localhost:5173. `renderEnvironmentCard` (app.js:730–737) toggles both cards from the store (`card.hidden = !hasSelection`, `emptyCard.hidden = !!hasSelection`). `#ldv-choose-device` → `devicePicker.open()` (app.js:4655).
2. **Active-status gating** — app.js:740/750: `['running','connected','connecting','reserving']` gate both kicker (LIVE DEVICE/DESKTOP) and card values; stale queued sessions no longer own the card — device/os/browser fall back to store selection. Confirmed by tester PASS 6/6.
3. **Dual-open fix** — deviceDrawer.js:566 `if (onOpenPicker) onOpenPicker(); else openDrawer();` — `??` bug gone; `onOpenPicker` wired at app.js:4626.
4. **CSS** — two identical `@media (min-width:1281px)` blocks (styles.css:7267–7275 cli-theme and 7689–7697) both restore `.device-chip-change { display:inline-flex; min-height:34px }` + hide `.device-chip-details`. Duplication harmless (identical declarations, base rules at 7536/7931 for ≤1280/≤1100 still hide it). Change visible only ≥1281px (721–1280 keeps 7536 rule... actually 7278/7700 block 1101–1280 sets inline-flex too).
5. Tests: npm test → 820 tests, 811 pass, 0 fail, 9 skip.

Remaining WARNs (minor):
- `ldv-card-status` still shows stale view liveLabel (e.g. "○ QUEUED") and runtime row shows when `view.runtimeSessionId` exists, even when card values come from store — cosmetic, noted by tester.
- `activeRun` status array duplicated at L740/L750 (identical literals).
- Carried: Phase 1+2 uncommitted on PUSHKAR; card-badge vs summary honesty mismatch.
