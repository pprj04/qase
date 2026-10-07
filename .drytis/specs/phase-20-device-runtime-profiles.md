# Phase 20 · Device Runtime — profiles, permission scenarios, execution levels

## Goal
Ground truth for real-device-style execution: every catalog device model gets a
structured **Device Profile** (hardware, screen, DPR, touch, orientation,
input, user agent per OS/browser, media + permission capabilities, honest
capability answers — never invented). Environments gain a **permission
scenario** (camera/microphone/notifications/location: ALLOW/DENY/ASK) and an
**orientation scenario** (portrait/landscape/rotate-during-test). Runs record
the **execution level** actually used (REAL DEVICE / VIRTUALIZED / SIMULATED)
and the *actual* runtime facts (real UA string, real viewport, real DPR) —
never derived from wishful catalog data.

## Files
- `server/postgres/migrations/019_device_runtime.sql` — extend `device_models`
  (user_agent_os, dpr REAL, touch BOOLEAN, input, media + permission caps as
  jsonb), `environments` (permission_scenario jsonb, orientation_scenario,
  execution_level_requested), `qa_runs` (execution_level_actual,
  execution_provider_actual, runtime_facts jsonb).
- `server/deviceProfiles.js` (new shared module, supersedes the legacy 8
  profile list) — authoritative structured profiles per device model; seeded
  into the DB catalog by `server/deviceCatalogSeed.js`.
- `server/environmentService.js` — accept + validate permission/orientation
  scenarios (whitelisted values only); capability answers per platform
  (e.g. screen sharing on iOS Safari: limited/not-supported → recorded
  honestly, never "supported").
- `server/browserBridge.js` — the launch seam: apply UA + DPR + touch +
  `context.grantPermissions` from the resolved profile + scenario in the
  emulated path; feed real runtime facts back (UA actually seen, viewport
  actually used) into runtime_facts.
- UI: environment editor (Device Matrix) gains permission/orientation
  scenario pickers; device drawer shows capability chips.

## Acceptance criteria
- [ ] Selecting iPhone 16 Pro / iOS 18.3 / Safari SIMULATED run sends a real
      iPhone Safari UA (not desktop Chromium), DPR 3, touch on, isMobile,
      and the run row stores the UA actually used.
- [ ] Camera DENY scenario → page's getUserMedia fails with NotAllowedError;
      Camera ALLOW → succeeds; the run record says which scenario was applied.
- [ ] A platform-unsupported capability (e.g. screen share on iOS Safari) is
      returned as NOT SUPPORTED, never silently treated as pass.
- [ ] Runs record execution_level_actual: SIMULATED for local emulation,
      VIRTUALIZED for BrowserStack-style remote, REAL DEVICE only when the
      provider attests a physical device session.
- [ ] Existing environments/runs (no scenario fields) keep working unchanged
      (all fields nullable; migration additive).
- [ ] npm test green; new unit tests for scenario validation + profile data.

## Edge cases
- Ask-for-permission scenarios (ASK) map to Playwright `grantPermissions`
  absence — page prompt appears; agent must handle the prompt state.
- Rotate-during-test only valid on touch devices; validation rejects it on
  desktop profiles.
- DPR stored as REAL (2.625-style Android DPRs are not integers).
