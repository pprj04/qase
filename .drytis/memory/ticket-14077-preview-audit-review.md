# #14077 (Exec Panel Phase 3) review — PASS

Spec: .drytis/specs/exec-panel-phase-3-preview-audit.md. Change: viewForSelection()
in activeRuntimeEnvironment.js + source-split in renderLiveDeviceViewHeader (app.js:1048-1084)
+ T17a-T17d acceptance tests (+T16j F-C regression guard added earlier in same tree).

## Key design verified
- viewForSelection: exact 19-key shape parity with resolveActiveRuntimeEnvironment;
  executionType lowercased from store's uppercase catalog values; executionTypeAttested
  always false (honest); reuses parseResolution/orientationFor/deviceKindFor/browserKeyFor.
- Source split: activeRun predicate (running/connected/connecting/reserving) is
  character-identical in header (1048) and env card (1100/1110) — no mixed-source path.
  Badges (exec/live/statusMap) stay SESSION-driven; only device-label/title/chrome/frame
  take headerView. headerView.runtimeStatus ('queued') is NEVER rendered — statusMap
  reads view.runtimeStatus only, so QUEUED can't appear for a pure selection.
- Store shape notes: activeTestEnvStore.get() = resolveForEnvironment: deviceType is
  raw catalog value ('mobile'→phone via deviceKindFor), executionType =
  executionLevelRequested ?? runtimeAttestedLevel (UPPERCASE), resolution =
  screenResolution ?? screenSize (string for parseResolution).

## Suites
npm test 826/0/9, public 95/95, acceptance PASS (T1-T17d incl. T16j), test:ui PASS
6 resolutions + cd-form-expanded, console clean. No throttle trip.

## Open WARNs
- viewForSelection has NO unit test (only end-to-end T17a-d). Recommend adding to
  activeRuntimeEnvironment.test.js (shape parity / null / lowercase / no-attestation).
- Zero-run workspace boot path (!view, app.js:1033-41) renders store device in header
  but skips applyDeviceFrame(viewForSelection) — stage frame waits for first session.
  Pre-existing shape, minor.
- device_unavailable sessions: unavailable panel now hidden when not in active set,
  but header badge (✕ DEVICE UNAVAILABLE) + exec-target block still surface it — OK.
- Carried (see ticket-14074-14075-exec-panel-gotchas.md): browser-option value=name
  only; pre-login 401 noise; targetUrl not-focusable on dialog submit.
