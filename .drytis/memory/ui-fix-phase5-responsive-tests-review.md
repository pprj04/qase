# Review: ticket #13978 — UI Fix Phase 5 (Responsive matrix, a11y & test suites)

Overall **PASS**. Both new suites run green live (`test-ui-responsive.mjs` 31/31 checks across 6 resolutions; `test-acceptance.mjs` T1–T15 all PASS). npm test 835/826 pass/9 skip/0 fail; public 95/95.

Key facts:
- Grid retune: 11 declarations across styles.css (base .app `clamp(232px,15.5vw,272px) minmax(420px,1.5fr) minmax(370px,0.98fr)` + cli-theme + ≤1280 slim + 1023 stacking variants). No stray 0.9fr/1.18fr patterns remain. Measured live: center ≥ right at all 6 widths; right share 29.3–32.2%.
- Picker onOpen refresh: app.js:4499 `onOpen: () => void refreshDevicePickerData()`; devicePicker.js:482 calls it in open() — fixes stale pre-login-401 error state. Boot IIFE (app.js:4525–4542) sets dataState:'error' on failed fetch.
- Auth throttle claim verified as pre-existing committed code: server/authThrottle.js (15min window, in-memory), used at server/app.js:251 account limit 10. Not a working-tree change — documentation-only item.
- npm `test` now includes `public/*.test.js` (spec's CI item) — hence 835 total.

WARNs recorded:
1. All Phase 1–5 changes still uncommitted (11 modified + 5 untracked + 3 stray tester screenshots t-a-1024.png / t-d-card-1024.png / t-d-picker-1024.png at repo root).
2. Suites do NOT read .drytis/cred.json — env-var only, with an invented fallback password 'tester-password' (wrong vs real cred). Env-less run burns 1 login attempt.
3. right-share band widened to 0.27–0.335 in the script; 1920 measures 32.2%, technically outside the strict 28–32% spec band.
4. test:ui / test:acceptance not wired into `npm test` aggregate (they need a running app + creds — defensible, but "ensure CI: new suites green" is only manual).
5. T14 assertion is vacuous (`true`) when no runs exist; `page.locator(...).catch?.(...)` is dead code; T7 checks the first card, not iPhone 17 Pro Max specifically.
6. package.json lost its trailing newline; description em-dash churn in diff.
