# RT4 media research notes (gathered during RT2)

## Chrome fake media flags
- `--use-fake-device-for-media-stream` gives fake cam/mic; `--use-fake-ui-for-media-stream` auto-approves the prompt.
- Historical bitrot: fake-ui did NOT work in old headless mode (discuss-webrtc thread, chromium bug 776649 — "Headless mode doesn't currently support granting permissions").
- Modern approach (Playwright): launch Chromium/branded Chromium browsers with `--use-fake-device-for-media-stream` arg AND `context.grantPermissions(['camera','microphone'], {origin})`. Playwright permission granting works in new headless.
- DENIAL path: do NOT grantPermissions → getUserMedia rejects NotAllowedError in headless (auto-deny) — that IS the denial scenario. Can also use `context.clearPermissions()`.
- Firefox fake media: preference `media.navigator.streams.fake` (about:config / launch prefs).
- NotAllowedError also occurs in insecure contexts — our app must be served over HTTPS (preview URL is https) for getUserMedia tests; localhost also counts as secure.

## Implementation plan
- browserMedia.js exists already (mic only). Extend to camera/mic/screen:
  - grant path: fake-device arg + grantPermissions → expect stream with tracks.
  - deny path: no grant → expect NotAllowedError, verify recovery UI (re-request after grant).
  - call controls: mute/unmute, camera on/off, hang-up buttons on the Meeting Link demo page must respond for real (track.enabled toggling).
- Health check (RT2): if workflow requires camera/mic, pre-check = can we launch browser with fake device flags (cheap: capability probe), NOT actual hardware.

## Sources
- MDN getUserMedia (NotAllowedError semantics, secure context requirement)
- discuss-webrtc "A question about getUserMedia and Chrome headless" (bitrot history)
- Cyara blog on manipulating getUserMedia with selenium flags
