# RT4 #14756 — DONE (2026-10-05)

Closed via move_ticket to Done (update_ticket rejects #14756 — same stale-board-tool bug as list_board_tickets; ticket IS on the server, the tool just can't see it).

## Shipped
- browserMedia.js: exerciseMeetingControls (page join/mute/unmute/cameraOff/cameraOn/leave via __qaseMeetingControls hook or DOM semantic scan; per-control before/after track evidence; UNRESOLVED/NO_EFFECT honest), verifyPermissionRecovery (deny→request→re-grant→retry through real CDP permission layer; RECOVERED/NOT_RECOVERED/INCONCLUSIVE), meetingCallState (joined = ACTIVE live-track stream, not just a reference).
- browserBridge.js: media actions meeting_controls + meeting_recovery; capability truth from launchedEngineId.
- browserTools.js: browser_media schema enum + validator accept both new actions (joinSelector/requestSelector/controls/targets) — reviewer's WARN, fixed and re-verified by infra_verifier.
- defectFixtures.js: __qaseMeetingControls hook on the meeting fixture; renderDefectFixturePage(id) export; __qaseMediaEvidence init bug fixed.

## Critical runtime facts (do not re-derive)
1. Headless Chromium: getUserMedia → NotSupportedError ALWAYS, even with --use-fake-device-for-media-stream. Real permission semantics need HEADFUL under Xvfb :77 (headless:false + env DISPLAY=:77).
2. CDP Browser.setPermission: settings are lowercase 'granted'/'denied'/'prompt'; permission names 'camera','microphone','display-capture' (NOT videoCapture/audioCapture — those throw Invalid PermissionDescriptor); pass browserContextId (from Target.getTargetInfo via a page CDP session).
3. Playwright context.clearPermissions does NOT deny media in this runtime; context.grantPermissions works for grant.
4. SDK loading in node --test children: use createRequire(import.meta.url).resolve('@cleanslate/sdk') + pathToFileURL — import.meta.resolve of the package name is unreliable there.

## Verification
Reviewer PASS 6/6, infra_verifier PASS, tester PASS 5/5 (preview shows honest denied:NotFoundError state with banner; Join stays disabled — deny-side defect confirmed in a no-camera context). All suites green; app restarted; preview 200. Recommendations left on ticket: normalize denial vocabulary in ledger; extract shared headful-launch helper.

## Standing
NIHARIKA branch: ALL RT work still uncommitted — publish before any redeploy. infra WARNs carried: stale QASE_BROWSER_ALLOWED_PRIVATE_HOSTS entry (platform-side), ~2.4k PID-1 zombies (known drytis-init reap issue; leaked test processes killed this round).

NEXT: RT5 #14757 (session/evidence isolation, video, findings context) per board order.