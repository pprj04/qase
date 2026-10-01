# Ticket #14075 — Round 2 review (2026-10-01)

Round-1 FAILs re-verified fixed in code AND live. RESULT: PASS. Agrees with tester's `ticket-14075-round2-retest.md`.

## Round-1 findings → fixes
1. **F-C (browser change discarded OS) — FIXED.** `cdFormOverrideChange` (app.js:878-896) now carries `osVersion`/`browser`/`executionLevel` from the store when not overridden, spread before `...overrides`. Field names line up: store's resolved env `osVersion` matches filter `String(e.osVersion)`; `browser` compared case-insensitive; `executionType` (= env.executionLevelRequested ?? runtimeAttestedLevel) matches the `(runtimeAttestedLevel ?? executionLevelRequested)` filter key. Loop-safe: store has no subscribe/notify → setSelection never re-fires onchange; handlers run once per user event. Live check: iPhone 11 → OS "17.0" → Browser "Safari" ⇒ summary "iPhone 11 · iOS 17.0 · Safari 17.0", OS select stays 17.0 (round 1 jumped to 26.0).
2. **F-F (selects clipped @1024×768) — FIXED.** `.viewer > *` children `min-width:0` (styles.css:1643-1647), `.cd-head` min-width:0 (8751), `.cd-form` = `repeat(2, minmax(0,1fr))` (8813) → `1fr` ≤520px (8818), `.cd-field` min-width:0. Live @1024×768: all 4 select rights ≤948 ≤ viewer right 963, docOverflow 0, pageScroll 0. Stage letterboxing intact: `#stage-inner` is `hidden` at idle so 0×0 is by design; aspect-ratio rules (styles.css:8549+) untouched; stage track 298×214 @1024, same as round-1 measurement.
3. **Dead CSS — FIXED.** `.cd-secondary` block deleted; grep across public/+scripts/ = zero refs to cd-secondary/renderCdSecondary/cdReselect.
4. **Inline catalog staleness — FIXED.** `setChooseDeviceOpen` calls `refreshDevicePickerData()` when `dataState !== 'ready'` (app.js:922). Verified the guard isn't vacuous: refresh sets dataState to 'loading' first (4861) and the guard passes for 'loading' too, so a slow boot fetch can't permanently mask it. Live: pre-login 401 + login + expand → 79 device options.
5. **Coverage gap — FIXED.** test-ui-responsive.mjs:105-135 now expands #choose-device at 1920×1080 AND 1024×768, asserts all selects inside viewer rect, no h-overflow/page-scroll. Both PASS. Round-1 vacuous pass closed.

## Suites
npm test 826/0/9 skipped; node --test 95/95; test:acceptance PASS (T16f–T16i incl. new browser-follow + badge-agrees checks); test:ui PASS all 6 resolutions + 2 new cd-form-expanded; curl 200.

## Remaining WARNs (minor, non-blocking)
- Browser select option `value` is browser name only (app.js:832) → 4 "Chrome 13x" options share value "Chrome". Selecting "Chrome 139" resolves to catalog's first Chrome on that OS (summary shows 138) while the select label stays "Chrome 139". Pre-existing from round 1, not a regression. Unique-named browsers (Safari) work correctly.
- No automated test covers browser-change-while-non-default-OS (the exact F-C regression); T16h covers OS change only. Verified live manually.
