# #14474 M7 — legacy picker chips + card list removed; browserVersion resolution bug found & fixed

## What shipped
- index.html: both .dp-chip-row filter blocks (data-dp-tab / data-dp-type) removed; #dp-cards kept in DOM `hidden` as the shared loading/error/empty surface. styles.css bump v=20261002-6.
- devicePicker.js: renderCards() reduced to load-state-only (returns early on ready); deleted card loop, renderCardOptions, cardsModel, TYPE_BY_CHIP, chip click wiring, `tabs/types` destructure, and .dp-chip/.dp-card/.dp-group/.dp-select CSS (~17 rules). buildDeviceCards/filterDeviceCards/cardBadge/browsersForOS exports untouched (matrix + tests still use them).
- Suite 1149 / 1129 pass / 0 fail / 20 skip.

## Real bug found by tester round 1 (fixed same ticket)
Browser-version row clicks in the matrix columns didn't change the selection — stayed on the auto-resolved default. Root cause: `createDevicePicker.selectEnvironment(env)` passed only `{osVersion, browser}` to reselect, dropping `env.browserVersion`; AND `resolveDeviceEnvironment()` had NO browserVersion filter at all, so version pins were impossible anywhere. Fix: resolver now filters `browserVersion` (unknown combo still falls back to best env), selectEnvironment passes the full triple, hydrate() also pins the persisted version. Regression test added in devicePicker.test.js ("#14474: browserVersion override pins the exact matrix row"). Tester round 2 PASS 5/5 (Brave 136 → Chrome 153 → 156 → Edge 154 all reflect in summary + dashboard chip).

## Known follow-ups (WARNs from reviewer, NOT done)
- scripts/test-acceptance.mjs still waits on `#dp-cards .dp-card` / `.dp-select-btn` selectors (T7/T8) — will time out when next run manually; needs rewrite to matrix selectors.
- The separate "Device matrix" drawer (bottom-bar "Device details") still has its own platform tablist + saved-environments list — different dialog, out of M7 scope, untouched.
- M1–M7 all still uncommitted on NIHARIKA alongside unrelated tickets; reviewer advises commit-split before landing/publishing.
