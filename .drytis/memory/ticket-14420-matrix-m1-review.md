# Review: #14420 Matrix M1 — catalog channels + Surface/Apple devices (PASS overall)

Suite 1127/1107 pass/0 fail/20 skip (reproduced). validate-matrix.mjs ALL CHECKS PASSED (7b/7c new).

## Verified live
- channelForVersion purely positional: chrome 156=canary 155=dev 154=beta 153=stable, firefox 158=nightly, unknown browser/version→stable, numeric input coerces. No hardcoded version in logic (only in one test expectation, fine).
- Back-compat: diffed HEAD catalog vs working tree — all 36,619 old envIds present in the 38,458-row new gen, byte-identical, 0 dupes. envIds deterministic.
- Clamp 80000 everywhere (app.js:555,644-645; environmentService.js:423,566; postgres repo :414; app.js:808,6364,6386). No 50000 left in production code. Live: ?limit=80001 → 400 with "1 through 80000" message; active envs 38,458; full table 41,374 (retired+PROV included) — both < 80k.
- Devices 174 total, Windows 12; SURFPRO11 (76 rows) / MACMBA-M1 (308 rows) live via API.
- Version 2027.02.0 pinned in catalog + provider registry + api + postgres tests.

## Minor divergences from spec text (ticket-scoped, not blocking)
- Spec M1 says "Surface Go (3/4)": only Go 3 implemented (ticket scope = Go 3).
- Spec M1 says iMac 24" M1 "Monterey–Ventura": implemented Monterey–Sonoma (factually correct — iMac 2021 supports Sonoma; spec text was conservative). Ticket accepts Monterey–Sonoma.
- mac() helper at environmentCatalog.js:516 remains dead/unused (pre-existing; new macModel() calls don't touch it).

## Non-M1 changes riding in the same working tree (already reviewed separately)
- environmentService.js seed provider-overlay + postgres seed overlay + upsertProviderRow + catalogProviderRegistry rowCount fix = #14275 Phase 2 (see ticket-14275-catalog-phase2-review.md, round 2 all-PASS).
- public/ theme wiring (themeStore, #cfg-theme) + styles.css + index.html = #14383–14386 theme tickets.
