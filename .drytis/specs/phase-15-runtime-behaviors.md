# Phase 15 · Runtime behaviors: permissions, orientation, touch, media honesty

## Goal
When executing against a device profile, the runtime actually behaves like the device: permission scenarios (ALLOW/DENY/ASK per permission), orientation control incl. rotate-during-test, true touch-style interaction, mobile page lifecycle, and honest media testing (REAL vs SYNTHETIC vs VIRTUAL never conflated).

## Permissions (server/deviceRuntime/permissions.js)
- Scenario object: { camera: 'allow'|'deny'|'ask', microphone: ..., notifications: ..., location: ... } — selectable per run/test case; default from device capabilities.
- Local (Playwright): allow → context.grantPermissions + CDP override; deny → CDP Browser.setPermission denied; ask → no override (browser default prompt state; agent records the prompt behavior).
- BrowserStack: capability flags per platform; unsupported combos (e.g. screen-share on iOS Safari) resolve to "NOT SUPPORTED" — recorded as such, never PASS.
- `POST /api/sessions` accepts `permissionScenario`; stored on run; included in deviceSession stamp.

## Orientation
- portrait/landscape applied at context creation from env.orientation (existing) or run override.
- New mid-test rotate: `POST /api/sessions/:id/rotate` → provider swaps viewport/UA-safe fields; run activity records rotation; safe-area behavior testable via viewport + meta queries.

## Touch interaction (server/deviceRuntime/touch.js)
- Extend browser tools: tap, double_tap, swipe (direction+distance), long_press (duration), drag, pinch_zoom — implemented via Playwright touchscreen/mouse-with-touch-events (pointerType touch), mobile scrolling, software-keyboard behavior (focus → virtual keyboard state via viewport insets where detectable).
- Mobile navigation: back-navigation gesture (Android back / iOS swipe-back) via history API + touch sequence.
- Desktop envs keep mouse/keyboard; touch tools on non-touch devices → "NOT SUPPORTED".

## Media honesty
- Media checks report source: SYNTHETIC (local fake devices — today's SYNTHETIC_MEDIA_ARGS), REAL (verified real device camera/mic), VIRTUAL (cloud browser virtual media).
- Meeting-link tests (camera/mic enable-disable, device switching, permission re-grant) run through provider's media controls; result text includes source tag.

## Acceptance criteria (running app)
- [ ] Run with permissionScenario {camera: deny} → navigator.mediaDevices.getUserMedia fails; finding/report says "camera DENY scenario"
- [ ] Mic ALLOW + camera DENY mixed scenario works; permission persistence across reload respected
- [ ] iOS Safari env requesting screen share → recorded NOT SUPPORTED, not PASS
- [ ] Rotate endpoint flips viewport mid-run; evidence frame after rotation shows landscape
- [ ] Touch tools produce touch-type events (pointerType 'touch') verifiable on a test page; long-press triggers contextmenu on Android env
- [ ] Media evidence tagged SYNTHETIC when local; never claims hardware media
- [ ] Windows/Mac envs: touch tools return NOT SUPPORTED; mouse tools intact

## Edge cases
- DENY then re-grant mid-test (permission re-enable flow) supported
- Rotation during a modal/keyboard-open state
- ask-scenario on headless local (prompt can't show) → recorded as "prompt-unobservable", not silently allowed

## Tests
Unit: scenario→override mapping matrix; touch tool dispatch; NOT SUPPORTED matrix per platform/browser. Integration: permission flow on local Chromium.
