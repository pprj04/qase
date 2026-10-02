# Phase 1 · Catalog data expansion (devices, OS versions, hardware form factors)

Goal: expand `server/environmentCatalog.js` device coverage per the agreed family list — **data only**. No UI, route, or styling changes. Catalog version bump. Existing envIds/IDs stay stable (no renames of existing devices).

## Additions

### iOS
- Legacy iPhones: X, 8, 8 Plus, 7, 7 Plus, SE (1st/2nd/3rd gen), XR, XS, XS Max — with honest per-device iOS version ranges (e.g. iPhone 7: iOS 13–15, not 26).
- iPhone SE naming must distinguish generations (`iPhone SE (3rd gen)`).
- iPad generations per line: standard iPad (5th–11th gen as supported), iPad Air (3rd–7th), iPad mini (5th–7th), iPad Pro 11 (1st–5th), iPad Pro 12.9 (1st–6th), iPad Pro 13 (M4). Each with per-device iPadOS/iOS range (older iPads cap at iOS 12/15/16 as factual).
- iOS/iPadOS versions from iOS 13 (floor for legacy SE/7) through 26.x.

### Android (per-device honest OS ranges — never assign an unsupported version)
- Samsung: fill S series (S21–S26 Ultra/+/base variants where factual), A series (A15/A25/A35/A54/A55), M series (M34/M35/M55), Note 20 line, Tab series (Tab S9/S10, Tab A9+ — first Android tablets), Z Fold (5/6), Z Flip (5/6).
- Google: Pixel 6/6 Pro, 7/7a, 8/8a, 9/9 Pro/9 Pro XL/9a, 10/10 Pro, Pixel Fold, Pixel Tablet, A-series (6a/7a/8a/9a).
- Missing manufacturers: POCO (X6/F6), Sony Xperia (1 VI/5 V/10 V), Asus (Zenfone 10/11, ROG Phone 8), Lenovo (Tab P12), Huawei (P60/Mate 60 — note: no Google services; still listable as simulated envs), Honor (Magic 6/90), plus Xiaomi 15/15 Pro, Redmi Note 13 Pro/Note 14, Nothing Phone (3a).
- Android 12–16 as supported per device; do not give a 2021 device Android 16.

### Windows
- OS versions: 11, 10, 8.1, 8, 7 (Server is NOT supported by the execution infrastructure — exclude, document why).
- Form factors as devices: Desktop, Laptop, Touchscreen Laptop, Tablet, 2-in-1 (new `deviceType: 'two-in-one'` threaded catalog→seed→picker chips), with distinct screen resolutions per form factor.
- OS selectable independently of browser version (already true via env matrix — keep).

### macOS
- Replace one-pseudo-device-per-OS with hardware models: MacBook Air (M2/M3/M4), MacBook Pro (14/16 M-series + Intel 2019), iMac (24 M4, 27 Intel), Mac mini (M4), Mac Studio (M2/M4 Max), Mac Pro (M2 Ultra).
- Each model with honest macOS range (Intel models cap at Monterey/Ventura per Apple support facts; Apple Silicon Monterey→Tahoe). High Sierra/Mojave/Catalina remain available via supported Intel models only.

## Rules
- Stable unique IDs; no duplicate (device, osVersion, browser, browserVersion) combos; `generateEnvironments()` determinism preserved.
- Bump catalog version to 2027.01.0 (major data expansion).
- `server/deviceCatalogSeed.js` categories must include every new manufacturer; existing seeded rows must not flip `active`.
- Expected scale: ~220–260 devices, env count will grow several-fold — Phase 5 handles caps/performance; this phase only updates `validate-matrix.mjs` expectations.

## Tests
- Catalog unit tests: every listed family present; per-device OS ranges within factual bounds (spot fixtures); no duplicate envIds; Safari absent on Android/Windows; iOS non-Safari browsers marked WebKit-constrained (existing rule kept).
- `validate-matrix.mjs` ALL CHECKS PASSED at new scale.
- Existing suites stay green (expect ~env-count-dependent tests updated).

## Edge cases
- Env explosion: assert matrix size in tests so a runaway generator fails loudly.
- Old DB rows for renamed/removed pseudo-devices: none removed (mac pseudo-devices retired → mark `active:false` seed rows, never delete).
