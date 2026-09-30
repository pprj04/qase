# LDV Phase 1 · activeRuntimeEnvironment view-model (single source of truth)

## Goal
Create `public/activeRuntimeEnvironment.js`: a pure module that normalizes a session snapshot into ONE object every live-view component reads. Ends the current scatter of 4+ fallback chains.

## Exports
`resolveActiveRuntimeEnvironment({ session, environments, runtimeBoard })` →
```
{
  device, deviceId, manufacturer, model, deviceType,      // deviceType: 'phone'|'tablet'|'desktop'
  os, osVersion, browser, browserVersion, browserKey,     // browserKey: 'safari'|'chrome'|'firefox'|'edge'|'opera'|'brave'|'duckduckgo'|'other'
  resolution: {width, height}, orientation: 'portrait'|'landscape',
  executionType: 'real_device'|'virtual_device'|'simulated'|'none',
  runtimeSessionId, runtimeStatus,                        // mapped runtime state vocabulary
  label, targetUrl, source: 'environmentSnapshot'|'runtimeFacts'|'legacyDevice'|'none'
}
```
Rules:
- Precedence: `session.environmentSnapshot` > `session.runtimeFacts` (+ attestation) > `session.device` legacy > none. NEVER fall back to a generic device when a snapshot exists (AC "do not show wrong device").
- `executionType` from `runtimeFacts.executionLevel` / `env.executionProvider` + attestation verified flag; never inferred from the device NAME (D3 honesty rule).
- `runtimeStatus` vocabulary: `queued | reserving | connecting | connected | running | completed | failed | device_unavailable` — mapped from `session.status` + deviceRuntime session status (`created`→connecting, `queued`→queued, running→running, done→completed, error/failed→failed, availability NOT_EXECUTABLE/OFFLINE→device_unavailable).
- `browserKey` from browser string match (case-insensitive), `orientation` from env orientationScenario / frame viewport w<h.
- Resolution from `environmentSnapshot.screenResolution` ("1179x2556") — parse, never invent.

## Files
- NEW `public/activeRuntimeEnvironment.js`, `public/activeRuntimeEnvironment.test.js`
- `public/app.js`: add `state.activeRuntimeEnvironment`, recompute in `applySessionSnapshot` + `handleEvent` (status/frame/env events); existing `renderLiveDeviceViewHeader` refactored to consume it (no behavior loss).

## Acceptance criteria (running app)
- [ ] With an environment snapshot present, header/card shows exactly that device/OS/browser/version — no fallback text.
- [ ] A run with no verified attestation never shows REAL DEVICE.
- [ ] All seven runtime states are representable and observable in the badge.
- [ ] Pure-logic tests cover precedence, all browser keys, orientation parsing, execution honesty.

## Tests
- Unit: snapshot precedence; attestation-gated executionType; status mapping incl. device_unavailable; resolution/orientation parsing; legacy-device fallback only when no snapshot.
- Regression: existing 794-test suite stays green.
