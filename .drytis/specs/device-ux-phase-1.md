# DX Phase 1 · One Device Picker + activeTestEnvironment store

## Goal
ONE device-selection mechanism. `public/devicePicker.js` (drawer: TEST ON DEVICE header, search, platform chips All/Apple/Android/Windows, type chips Phone/Tablet/Desktop, grouped device cards with os·browser line + honest execution/availability badge + Select). Cards derive from existing `/environments?active=true` grouped by device, ranked (attested execution level > isRealDevice > latest osVersion). In-picker secondary options: OS version dropdown + browser list filtered to existing active envs for device+OS; changing either re-resolves envId automatically.

`public/activeTestEnvironment.js` — `createActiveTestEnvironmentStore({ persistenceKey })`: get/setSelection/clear + resolveForEnvironment → canonical `{ envId, deviceId, device, deviceType, os, osVersion, browser, browserVersion, resolution, orientation, executionType, availability, runtimeSessionId }`. Keeps `qase.environmentId` in sync for backward compat (startEnvironmentRun, presets, drawer default). No separate selectedDevice/selectedBrowser state anywhere.

## Files
NEW public/devicePicker.js + .test.js; NEW public/activeTestEnvironment.js + .test.js; public/app.js (store wiring, state.activeTestEnvironment, picker opens from Change + quick action); public/index.html (picker dialog); public/styles.css.

## Acceptance criteria
- [ ] Select iPhone 17 Pro → env auto-resolves; summary shows full combination + honest execution/availability.
- [ ] Browser switch → env re-resolves; only executable browsers listed.
- [ ] Device switch → os/browser/resolution/availability update.
- [ ] Selection persists across reload; single store object only.
- [ ] Existing suite green; pure-helper tests for grouping/ranking/resolution/store.
