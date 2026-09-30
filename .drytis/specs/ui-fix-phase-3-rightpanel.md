# UI Fix Phase 3 — Right panel hierarchy, runtime status model & sidebar (P1)

Branch: NIHARIKA only, after Phase 1 (tabs moved) and Phase 2 (picker ported).

## Goal
Right panel becomes a clean hierarchy: compact LIVE DEVICE card (device/OS/browser + honest SIMULATED/REAL badge + single-source runtime status + [Change]/[Details]) → device/browser status → live preview taking remaining height, with its own scroll context. Sidebar reduced to everyday items with Device Matrix under Settings → Device Management. One status vocabulary everywhere.

## Current state (NIHARIKA)
- Right panel `.panel.viewer` holds (post-Phase-1) preview + env card area. #ldv-* markup is PUSHKAR-only; NIHARIKA has #device-chip in feature-dock (index.html:262-270) and viewer sections #stage/#stage-inner/#frame (:200-255).
- Sidebar footer: #open-environments, #open-device-matrix, #open-test-cases, #open-bulk-run (index.html:91-94).
- Runtime statuses in NIHARIKA: assorted (queued/running/…); no RESERVING/CONNECTING vocabulary.

## Changes
1. Compact device card at top of right panel: kicker (LIVE DEVICE when runtime active, else CURRENT TEST DEVICE), device model, OS · browser line, badges (SIMULATED/REAL honest; runtime status pill). [Change] opens the ONE picker; [Details] opens a collapsible capabilities panel (Touch/Camera/Microphone/Screen/Orientation).
2. Runtime status model: single source activeRuntimeEnvironment.view-model status, mapped to the agreed vocabulary QUEUED/RESERVING/CONNECTING/CONNECTED/RUNNING/COMPLETED/FAILED/BLOCKED/DEVICE UNAVAILABLE/RELEASED. UI reads only this map — no per-panel status strings.
3. SIMULATED/REAL agreement: center, right panel, results, evidence all read executionType from the same view-model; results/evidence rendering paths updated to use it.
4. Sidebar: remove Environments/Device Matrix as primary items; keep My account/Settings/Test cases/Bulk runs/Results/Bugs; Device Matrix moved under Settings → Device Management (opens the existing #device-matrix modal via the existing deviceMatrixView).
5. Feature-dock device chip remains but reads activeTestEnvironment; [Change] there opens the same picker.
6. Preview frame keeps its own scroll context (image/stream area overflow:auto, stage fixed to panel bounds).

## Acceptance criteria (running app)
- [ ] Right panel order: device card → preview; the metadata card never consumes the whole panel; preview visible at 1024×768.
- [ ] LIVE DEVICE / CURRENT TEST DEVICE kicker switches correctly between active run and idle.
- [ ] Badge is SIMULATED whenever runtime is not verified-real — in center, right, results and evidence simultaneously; never REAL anywhere when others say SIMULATED.
- status pill shows exactly one state from the vocabulary, from one source, at all times.
- [ ] [Change] and dock chip both open the same picker; [Details] expands capabilities inline.
- [ ] Sidebar no longer lists Environments/Device Matrix as primary; Device Management reachable via Settings.
- [ ] Session switch updates the device card from the run's environment snapshot, no stale device from previous run.

## Tests
- Unit: status map function (every vocabulary word covered); view-model → card/badges rendering.
- Browser: complete a run → device/OS/browser/status stay visible (completion persistence); switch session → card updates; 1024×768 preview usable.

## Edge cases
- Stale QUEUED sessions must not own the idle card (gate on activeRun like PUSHKAR did); DEVICE UNAVAILABLE state with [Retry]/[Choose another device] actions in-panel; orientation control only affects frame when runtime data supports it.
