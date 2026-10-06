# NI01 Phase 1 · Device catalog audit & gap-fill

## Goal
Make the device inventory in `server/environmentCatalog.js` (seed source of truth) and the DB-backed catalog (migrations 024/026/027, `server/deviceCatalogSeed.js`) provably cover the agreed first-version matrix. Extend existing structures — do NOT create a parallel catalog.

## Current state (from research)
- Apple: iPhone 7→17 Pro Max (incl. SE 1–3), iPads gen 5–11 / Air 3–7 / mini 5–7 / Pro 11"/12.9"/13" M4, Macs incl. MacBook M1–M5; iOS 13.0→26.0. iPadOS is its own platform (`ipados`).
- Android: Samsung S21–S25 Ultra, A/M series, Tab S9/S10, Z Fold/Flip 6, Pixel 6–10 + Tablet, OnePlus, Motorola, Xiaomi/Redmi, Oppo, Vivo, Realme, Nothing, POCO, Sony, Asus, Lenovo, Huawei, Honor. Android 12–16.
- Windows: Windows 7–11, Laptop/Desktop/Tablet/2-in-1, Surface line.
- macOS: back-catalog exists (ticket #14166/#14167 delivered OS/browser version depth).

## Work
1. **Audit** the frozen catalog against the NI01 required list (see ticket description) and produce a gap table (missing devices/variants/OS versions).
2. **Gap-fill** missing entries only. Required minimums:
   - iPhone: SE, 11–17 base + Pro + Pro Max + Plus/Mini where real, pinned to real iOS ranges.
   - iPad: iPad, iPad mini, iPad Air, iPad Pro 11", iPad Pro 12.9"/13" — with supported iPadOS versions and screen sizes; distinct from phones (own platform `ipados`, own envIds/viewports/OS metadata — already true; verify).
   - Android phones AND tablets across: Galaxy S/A/Z Fold/Z Flip, Pixel, OnePlus, Xiaomi, Redmi, POCO, Motorola, Oppo, Vivo, Realme, Nothing, Sony Xperia.
   - Windows: 10 and 11 × desktop/laptop × distinct resolution/viewport profiles.
   - macOS: Mojave→Tahoe × MacBook Air/Pro, iMac, Mac mini, Mac Studio, Mac Pro — only combinations a real macOS could run (respect hardware/OS-era compatibility; do not invent).
3. No fake availability: catalog rows describe *what exists*, execution availability is resolved separately (Phase 2).
4. Update `ENVIRONMENT_CATALOG_VERSION`; seeds remain idempotent (natural-key upsert).
5. Keep representative test applications / fixtures associable: verify `test_cases.environment_ids` accepts any generated env.

## Tests
- Catalog validation script/endpoint (`GET /api/catalog/validate`) passes with zero orphans/dupes.
- Unit-ish check: every NI01-required device family resolves to ≥1 environment in every store.
- Seed re-run is idempotent in postgres store.

## Edge cases
- Devices with no executable path anywhere still appear in catalog (they are inventory, not availability).
- EnvId scheme must remain stable for existing environments (append-only slugs).

## Acceptance criteria (running app)
- [ ] Device Matrix UI lists every required device family under its category (iOS, Android, Windows, Mac) with no duplicates.
- [ ] iPad/tablet profiles appear with their own viewports and iPadOS/Android-tablet OS info, not as phone profiles.
- [ ] Windows and macOS show multiple resolution/OS profiles per family.
