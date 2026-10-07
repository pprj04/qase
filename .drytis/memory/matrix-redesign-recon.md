# Device & Browser Matrix redesign recon (QASE-2.1, branch NIHARIKA)

Read-only audit done 2026-10-02 for the planned searchable device/browser matrix UI.

## Key facts
- Catalog: `server/environmentCatalog.js` (713 lines), `ENVIRONMENT_CATALOG_VERSION = '2027.01.0'`. 36,619 envs generated (ios 9702 / ipados 7854 / macos 4851 / android 12996 / windows 1216). Devices: 39 ios, 25 ipados, 14 macos, 80 android, 5 windows.
- NO Beta/Dev/Canary channels exist anywhere — `BROWSER_VERSIONS` is majors-only flat arrays. Adding channels = new data dimension.
- Windows devices are generic form factors (Laptop/Desktop/Tablet/2-in-1) — NO Surface models. macOS: MacBook Air M2/M3/M4, MBP14/16 M3/M4 + MBP16 Intel 2019, iMac Intel 2020 + M4, Mac mini M4, Studio M2/M4 Max, Mac Pro M2 Ultra.
- DB catalog = migrations **024** (device_catalog.sql) + **026** (cross_platform_catalog.sql), seeded via `server/deviceCatalogSeed.js` `buildCatalogSeed()` (NOT "migration 016").
- Picker: modal `<dialog id="device-picker" class="modal dp-modal">` in index.html:1336-1364; logic `public/devicePicker.js` (518 lines, pure helpers + createDevicePicker); wiring app.js:6303-6440. CSS: styles.css:11046-11093 (`dp-*`, `dcl-*`).
- Selection store: `public/activeTestEnvironment.js` — localStorage `qase.activeTestEnvironment` + legacy `qase.environmentId`. NO favorites/recents mechanism exists; no `qase.*` key for either.
- Compatibility: `isCombinationSupported()` envCatalog.js:528; server validation via `normalizeEnvironmentInput` (environmentService.js:57) + `GET /api/catalog/validate` (catalogApi.js:103). Client picker only offers combos that exist as active envs (`browsersForOS`, `resolveDeviceEnvironment`).
- Provider rows: `catalogProviderRegistry.js` namespacing `PROV-<SLUG>-…`, additive overlay, honesty contract.
- Theme: `qase.theme` localStorage, `<html data-theme>`, light tokens styles.css:5237+, store `public/themePreference.js`, Settings select `#cfg-theme` wired app.js:6317-6330.
- app.js is 6,801 lines / 257 KB orchestrator; feature modules ARE split (devicePicker, deviceMatrixView, deviceDrawer, etc.) — extend that pattern.
- validate-matrix.mjs = 13-point checklist (7 static catalog checks + 6 live-API checks, needs QASE_VALIDATE_COOKIE).
