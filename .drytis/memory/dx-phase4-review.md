# DX Phase 4 review (ticket #13908) — chips + picker add-mode. RESULT: FAIL

Spec: `.drytis/specs/device-ux-phase-4.md`. Suite green (811/0/9) but three runtime breaks — no DOM tests cover these views, so tests can't catch them.

## Critical findings
1. **bulkRunView.js: `deviceList` is never declared/created.** The import of `createDeviceChipList` exists (L23) and `deviceList` is referenced at L67 (refresh), L99 (resolvedPairs pick mode), L225 (applyPreset), L240 (getter) — but no `createDeviceChipList({...})` call anywhere. Every `refresh()` (i.e. every wizard open) throws ReferenceError, caught by `fail()` → wizard shows no data, no preview. Pick mode and presets also throw.
2. **app.js:4262–4271 picker-host wiring IIFE is dead.** It reads `devicePicker` (const declared L4578) and `runTargetDevices` (L4286) — both TDZ at L4265/4269 → immediate ReferenceError, unhandled rejection, NONE of the three chip lists get `setPickerHost`. All `[+ Add device]` buttons silently do nothing (host null). Verified with a node repro: identical pattern throws `Cannot access 'devicePicker' before initialization`.
3. **testCaseView.js openEditor references undeclared `formEnvironments`** (L218–221; not in the destructure at L38–41, leftover from deleted multi-select) → ReferenceError on every openEditor call: Edit button, Reset button, and post-create reset all crash. Also the claimed `deviceList.set(testCase.environmentIds)` prefill is absent.

## What is correct
- HTML/CSS: all three chip-list markup blocks + `.dcl-*` styles present and served.
- Payload unchanged: submit sends `environmentIds: deviceList.ids` (testCaseView.js:237).
- Add-mode isolation in devicePicker.js is correct (reselect → addPick branch never touches store.setSelection; close/dIALOG close clears addPick; Select buttons read 'Add'; add-mode summary line present).
- createDeviceChipList API (set/ids/clear/setPickerHost/remove-× with onChange) correct; envChipLabel correct.
- runTargetDevices list in app.js created correctly; openRunTarget/submitRunTarget use .set(assigned)/.ids correctly.
- No Ctrl/Cmd multi-select remains except #bulk-cases (test cases — allowed).

## Minor WARNs
- `setDefaultEnvId` never called (pre-existing at HEAD): bulk 'default' where-mode always yields 0 pairs.
- `.tc-form select[multiple]` CSS leftover; `onChange: () => {}` stubs.
- Add-mode dropdowns seed from the ACTIVE store selection (renderCardOptions reads store.get()).
- Carried: badge-vs-record honesty mismatch; changes uncommitted on PUSHKAR.

Fix outline: declare `const deviceList = createDeviceChipList({container: deviceChips, addBtn: addDeviceBtn, environmentsById: () => state.environmentsById, onChange: renderPreview})` in bulkRunView (needs environmentsById map built in refresh); delete the formEnvironments block + add `deviceList.set(testCase?.environmentIds ?? [])` in openEditor; move the app.js picker-host IIFE after `devicePicker`/`runTargetDevices` declarations (or wrap in a function called at end of module).
