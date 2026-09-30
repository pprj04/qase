# DX Phase 2 review (ticket #13906) — spec device-ux-phase-2.md

RESULT: **FAIL (1 blocker)** — suite green (811 pass / 0 fail / 9 skip), no silent default, no duplicate store state, all wired Change affordances open THE picker. But the **empty-state card was never added to index.html**.

## Blocker
- `#ldv-env-card-empty` and `#ldv-choose-device` **do not exist in public/index.html** (grep across repo: only references are app.js:732/4650 and styles.css:8637). CSS (.ldv-env-card-empty, .ldv-env-prompt) and the app.js handlers exist, but the markup is missing → AC11 empty state ("SELECT A DEVICE [Choose device]") never renders. `renderEnvironmentCard` guards `if (emptyCard)` so no crash; with no selection BOTH cards are hidden (`card.hidden = !hasSelection`) → no device card at all in the right rail.

## Discrepancies vs stated changes
- `#ldv-env-card` still carries the `hidden` attribute in markup (index.html:242) — task said it was removed. Functionally OK: renderEnvironmentCard manages visibility on every render.
- `openEnvironments()` (app.js:4074) is now **dead code** — no callers (button `#open-environments` removed from sidebar). The legacy `#environments` dialog markup (index.html:373–405) and envUi wiring also remain.

## Verified PASS
- Silent default removed: app.js diff shows `|| deviceDrawer.state.environments[0].envId` deleted; defaultEnvId now localStorage-only (4663, 4271–4273).
- Change affordances → picker: qa-choose-devices (4470), ldv-change-device (4649), ldv-change-env (880), drawer chip Change → onOpenPicker (deviceDrawer.js:566, wired app.js:4622).
- Sidebar: Environments button removed; Device Matrix → "Device Management"; quick action → "☰ Target device".
- renderEnvironmentCard: idle→CURRENT TEST DEVICE + store values; running→LIVE DEVICE/LIVE DESKTOP + view values; exec/status badges dataset-driven.
- DOM-safe (textContent), no new fetch surface/secrets.

## WARN
- Start-dialog env selects (#qa/#sqa/#founder-environment-select, populateEnvironmentSelect:616–619) still write `qase.environmentId` directly, bypassing the activeTestEnvironment store → chip/right card out of sync with a dialog-changed env until rehydrate.
- Phase 1+2 changes still uncommitted (carried forward infra WARN).
