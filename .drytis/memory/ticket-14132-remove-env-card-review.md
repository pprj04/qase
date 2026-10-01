# Ticket #14132 review (round 2, final) — remove CURRENT TEST DEVICE card; [Change] in live-view header

Branch NIHARIKA, working tree uncommitted. Supersedes earlier draft of this file; supersedes `.drytis/specs/exec-panel-phase-3-preview-audit.md` right-card scope.

## Verdict: PASS (all 6 contract items) — 3 WARNs, 0 FAILs
Matches tester's independent browser verification (7/7 PASS, see interaction log 2026 session).

## Evidence per contract item
1. Card removed: zero `#ldv-env-card`/`#ldv-env-card-empty`/`#ldv-card-toggle`/`#ldv-device-details` in public/, scripts/, server/. Live preview HTML confirms (curl grep count 0).
2. Collapse machinery gone: no `renderEnvironmentCard`/`DEVICE_CARD_COLLAPSED_KEY`/`deviceCardToggle`/`setDeviceCardCollapsed`/`syncDeviceCardCollapse`/`wireDeviceCardCollapse` anywhere; no `qase.deviceCardCollapsed` in any source (only acceptance selectors asserting absence, test-acceptance.mjs:177,269,277-278).
3. `#ldv-change-device` button in `#live-device-view-head` (index.html:218), wired once at app.js:4422-4425 `wireDeviceChangeAction` IIFE → `devicePicker?.open?.()`. The unavailable-state `#ldv-change-env` (app.js:856-857, index.html:234) also opens the SAME picker — not a second selection surface.
4. styles.css: `.ldv-env-*`/`.ldv-card-*` all removed; block at 8557-8560 is a removal comment. Remaining `.ldv-*` selectors (8163-8170, 8562-8581) are all live header/badge/unavailable styles.
5. Tests: `npm test` 831/0/9 ✓; `node --test public/*.test.js` 100/100 ✓ (rightPanelContract.test.js notes #14132); `npm run test:ui` PASS; `npm run test:acceptance` PASS — T16/T16b/T17a/T17d/T18 all assert cardGone + changeBtn. T17b NOTE = no iPad Pro in catalog (pre-existing, soft-pass).
6. No dead code found from the card; `renderLiveDeviceViewHeader` (app.js:668+) is the sole identity renderer.

## WARNs (minor, non-blocking)
1. index.html:196-198 stale comment still says "opened from the CURRENT TEST DEVICE card's [Change Device]" — card no longer exists; comment should say header [Change].
2. app.js:4417 comment says "Wire the live-view environment card actions: Change and Device details" — card removed; wording stale.
3. `.ldv-change` class on the button has no CSS rule (styling from btn/btn-ghost/btn-sm) — unused hook, harmless.
Cosmetic note from tester (out of scope): URL chip text clips to 0px at 1024×768.
