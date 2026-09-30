# Phase 13 · Device Profiles: runtime-accurate structured specs

## Goal
Every catalog device model gets a structured device profile with **real** specifications — pixel ratio, physical resolution, real user agents, hardware/media/permission capabilities — persisted in the DB, seeded from vetted data, exposed via API. No invented hardware.

## Files to change
- `server/postgres/migrations/019_device_profiles.sql` — extend `device_models`: `dpr numeric`, `physical_resolution text`, `touch_input boolean`, `user_agents jsonb` (per-OS-version UA map), `capabilities jsonb` (camera/mic/screen-share/notifications/location/gps/orientation with `supported|unsupported|platform-dependent` + notes); add `hardware` generation/notes fields. Widen `environments.platform` CHECK to include android|windows (missed in 018).
- `server/deviceProfileSpecs.js` (new) — vetted spec table per device family (iPhone 12–17 Air incl. 16e/17 Air, iPad lines, Macs by chip, Android models, Windows form factors) + UA builder per platform/OS/browser.
- `server/deviceCatalogSeed.js` — merge profile specs into seeded rows.
- `server/catalogApi.js` — include profile fields in `deviceModels` reads; new `GET /api/catalog/deviceModels/:id/profile`.
- Tests: `server/deviceProfileSpecs.test.js`, migrations test update.

## Acceptance criteria (running app)
- [ ] `GET /api/catalog/deviceModels/galaxy-s24` returns dpr 3.0, physicalResolution 1170×2532 (portrait), real Chrome-on-Android UA for API 35, touchInput true, capabilities.camera "supported"
- [ ] iPhone 16 Pro profile: 6.3", 1206×2622 physical, dpr 3, touch, camera/mic supported, screenShare "platform-dependent", keyboard "software"
- [ ] iPad Pro 13 has its own profile (2064×2752, dpr 2) — not derivable from iPhone
- [ ] Mac profiles record hardware chip generation (M1–M5) and screen defaults
- [ ] Windows 11 + Chrome vs Windows 11 + Edge yield different user agents
- [ ] No seeded capability claims "supported" without a source in the spec table
- [ ] Environments with platform android/windows persist (CHECK widened)

## Edge cases
- Devices lacking public spec data → capabilities default to "unknown", never invented
- UA for Safari tied to OS version (iOS 18.3 UA differs from 17.5); Chrome/Firefox/Edge stable per browser version
- Windows DPR varies by display → record as null + note "host-dependent"

## Tests
Unit: spec-table completeness (every seeded model has dpr+resolution+UA), UA builder per platform matrix, migration idempotency.
