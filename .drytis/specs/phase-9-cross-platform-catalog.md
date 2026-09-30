# Phase 9 · Cross-platform catalog: Android + Windows (data + validation)

## Goal
Extend the QASE-owned catalog from Apple-only to Apple + Android + Windows, fully data-driven, with valid device→OS→browser compatibility. No UI hard-coding; frontend unchanged in this phase.

## Current state (audited)
- Migration `server/postgres/migrations/016_device_catalog.sql`: `device_categories.platform` CHECK limits to `ios|ipados|macos` (line 29); `browser_platform_support` CHECK same (line 134).
- `server/catalogApi.js` line ~67: osVersions FK guard rejects unknown platforms.
- `server/environmentService.js` `capabilitiesFor` (115-132): BrowserStack capability shapes hardcoded for `macos` vs `ios`.
- `server/environmentCatalog.js` frozen Apple data + fallback validation.
- Seed: `server/deviceCatalogSeed.js` (pure functions → `buildCatalogSeed()`), consumed idempotently by `server/localDeviceCatalog.js` (`.qase/device-catalog.json`) and `server/postgres/deviceCatalogRepository.js`.

## Files to change
- NEW `server/postgres/migrations/018_cross_platform_catalog.sql` — drop/replace the two platform CHECK constraints (ALTER TABLE ... DROP CONSTRAINT, re-ADD with `ios|ipados|macos|android|windows`).
- `server/deviceCatalogSeed.js` — add Android categories/manufacturers/models, Windows categories/models, Android OS versions (11–16), Windows versions (10, 11), extend browser_platform_support (chrome/edge/firefox/opera/brave/duckduckgo × android/windows), and device_os_compatibility rows.
- `server/environmentCatalog.js` — extend PLATFORMS (android, windows), platform labels; keep Apple data intact.
- `server/catalogApi.js` — admit `android|windows` in the guard; expose a manufacturers grouping (hardware `vendor` column or a small `GET /api/catalog/manufacturers`).
- `server/environmentService.js` — `capabilitiesFor` shapes for android/windows (BrowserStack device/os names; local emulation fallback), `normalizeEnvironmentInput` device-type defaults (phone/tablet/desktop, orientation rules: android/windows desktop → null).
- `server/localDeviceCatalog.js` — FILTER_KEYS: confirm/extend platform + vendor filters.

## Catalog data to seed (minimum per request)
- ANDROID manufacturers: Samsung (Galaxy S21–S26, Note series, A series, Z Fold, Z Flip), Google Pixel (6–10, Pro variants, Fold), OnePlus (9–13, 13R), Motorola (Edge, Moto G, Razr), Xiaomi (flagship), Redmi (Note, standard), Oppo (Reno, Find, A), Vivo (V, X, Y), Realme (GT, Number, C), Nothing (Phone series), Other Android.
- WINDOWS models: Windows Laptop, Windows Desktop, Windows Tablet.
- OS: android 11,12,13,14,15,16 (minor versions allowed); windows 10, 11 (build/release notes allowed).
- Compatibility: modern Samsung/Pixel/OnePlus ↔ Android 14/15 (+13 where plausible); Windows models ↔ both Windows versions; all browsers on windows; chrome/firefox/opera/brave/duckduckgo on android (edge on android optional), safari NOT on android/windows.

## Acceptance criteria (running app)
- [ ] GET /api/catalog/deviceCategories returns apple + android + windows categories.
- [ ] GET /api/catalog/deviceModels?category android returns Samsung/Pixel/OnePlus/etc. models.
- [ ] GET /api/catalog/osVersions includes android:* and windows:* ids.
- [ ] GET /api/catalog/validate accepts Galaxy S24 + Android 15 + Chrome; rejects Galaxy S24 + iOS 18; rejects Windows Laptop + Safari; rejects Pixel 9 + Android 11 only if compatibility says so (modern device + old Android rejection is data, not code).
- [ ] POST /api/environments/bulk can create Android and Windows environments end-to-end; created rows appear in GET /api/environments with platform android/windows.
- [ ] Existing Apple environments, ids, and compatibility behave exactly as before (no renamed ids, no deleted rows).

## Tests
- Migration test updated for 018 (constraint now admits android/windows).
- Seed tests: android + windows row counts, Safari-not-on-windows, chrome-on-android present.
- Environment service: create Android env (envId format, capabilities shape), create Windows env; Apple regression unchanged.
- catalogApi: guard accepts android/windows; manufacturers endpoint.
- Existing suites stay green (npm test).

## Edge cases
- Duplicate seed rows (re-seed idempotency) — natural-key upserts only.
- `deviceModelSlug` FK on environments must accept new slugs.
- Local (QASE_RUN_STORE=local) and Postgres modes must seed identically.
