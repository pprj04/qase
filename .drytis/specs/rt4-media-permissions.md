# RT4 · Camera, microphone, screen-share & permission testing

## Goal
Meeting-link and similar workflows can validate real device/browser media behavior — camera, mic, speaker, screen share — including permission grant/denial, recovery, and call controls — identifying device/browser-specific defects honestly.

## Reality note
This container has no physical camera/mic hardware and no display server beyond Xvfb. Honest execution therefore means: synthetic/virtual devices where the browser supports them (Chromium fake media flags — a REAL browser capability, not a mock), and UNAVAILABLE with reason where the browser/engine cannot (WebKit/Firefox fake-camera support differs). No fake "camera worked" results.

## Work
1. **Camera probe** (`browserMedia.js`): extend the existing mic pattern — `getUserMedia({video})` with Chromium `--use-fake-device-for-media-stream` / `--use-fake-ui-for-media-stream`; capture a frame, verify track state + dimensions; WebKit/Firefox: probe and record honest result (likely UNAVAILABLE — no fake device).
2. **Screen-share probe**: `getDisplayMedia` with Chromium `--auto-select-desktop-capture-source` (Xvfb screen); verify track state; other engines → UNAVAILABLE with reason.
3. **Permission model**: permission pre-grant/deny via CDP `Browser.setPermission` (exists for mic today — extend to camera, display capture); "OS permission" level recorded as NOT_TESTABLE where the host OS layer is not exposed (honest).
4. **Call-controls workflow**: extend the meeting-link tool (`browser_test_meeting_link`) to exercise join/mute/unmute/camera on-off/leave with per-control evidence, and permission-denial recovery (deny → grant → track resumes).
5. **Wiring into health gate & profiles**: media capability declared per environment from probed reality (RT2), not catalog wishful thinking.

## Tests
- Probe unit tests with a stubbed context (track state machine).
- Live integration test on Chromium fake media: camera track opens, frame non-empty; denial path leaves track blocked and is reported as denied, not failed-to-test.
- Firefox/WebKit: probe returns UNAVAILABLE with engine-specific reason (asserted verbatim).

## Edge cases
- Fake-media flag unavailable on an engine → capability UNAVAILABLE, never simulated in JS.
- Permission denial + re-grant → recovery verified by track state transition.
- Multiple tracks/stop mid-call → teardown clean, evidence kept.

## Acceptance criteria (running app)
- [ ] A meeting-link run on Chromium records real camera/mic/screen-share probe results with evidence from the actual browser, including the permission-denied path.
- [ ] Environments whose engine cannot test a capability show that capability Unavailable with a reason; the run reports it as a gap, not a pass or silent skip.
- [ ] A device/browser-specific media defect (fixture) reproduces on affected profiles only, recorded per profile.
