# DX Phase 4 re-review (ticket #13908) — RESULT: PASS

All three fixes verified in source; tester re-run 7/7; suite 820 tests / 811 pass / 0 fail / 9 skip.

## Fixes confirmed
1. **TDZ wiring resolved** — picker-host wiring is now a synchronous block at app.js:4915–4919, the last statements of the module, well after `runTargetDevices` (L4275) and `devicePicker` (L4567) declarations. All three `setPickerHost(devicePicker)` calls (testCaseView, bulkRunView, runTargetDevices) run at module evaluation. No other `devicePicker` reference precedes L4567.
2. **testCaseView** — `formEnvironments` gone repo-wide; `openEditor` (L218) does `deviceList.set(testCase?.environmentIds ?? [])`; chip list getter `(id) => state.environmentsById.get(id)` (L207); submit payload `environmentIds: deviceList.ids` unchanged (L234); `deviceList` exported (L279).
3. **bulkRunView** — `const deviceList = createDeviceChipList(...)` present (L36–41) with `onChange: () => renderPreview()`; `state.environmentsById` Map (L35) built in refresh (L69); all four former undefined references now live (refresh L75, resolvedPairs pick-mode L107, applyPreset L233, getter L248).

## Verified behaviors
- Add-mode never touches active selection (reselect L372–377 routes to addPick, store unreachable; close/X clears addPick L446–447); duplicate-guard in the add callback (devicePicker.js:233).
- Bulk launch path per-pair unchanged (onLaunch delegate or POST /sessions per pair).
- No regressions: served markup has all 3 chip containers; only remaining multi-select is #bulk-cases (test-case selection, allowed); suite green.

## Remaining WARNs (carried / cosmetic)
- `setDefaultEnvId` still has zero call sites in app.js — bulk 'default' where-mode yields 0 pairs (pre-existing).
- "Devices: N" in bulk summary counts executable case×env pairs (intersection with case.environmentIds), not picked chips — honest, product decision pending.
- `onPickerReady` param unused; `onChange: () => {}` stub on testCaseView list; dead `.tc-form select[multiple]` CSS.
- Carried: badge-vs-record execution-level mismatch; all Phase 1–4 changes still uncommitted on branch PUSHKAR.
