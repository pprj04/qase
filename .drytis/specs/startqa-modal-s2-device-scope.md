# Phase S2 · Device-scoped selection inside the Start QA modal

## Goal
Selecting a device in the in-modal matrix scopes the configuration to that device (+ OS/version +
orientation), automatically SELECTS ALL its compatible/available browsers, and shows the device
summary. Changing device clears the previous device's browser selections (no stale state). Manual
deselection still works and survives only until the device changes.

## Files
- `public/qaConfigMatrix.js` — add device-scope helpers: `configurationsForDevice(index, {platform,
  device, osVersion})`, `compatibleBrowserFamilies(index, deviceKey)` (family selectable if ≥1
  AVAILABLE config for the device), `defaultSelectionForDevice(...)` = every AVAILABLE envId of the
  selected device across all compatible families.
- `public/app.js` — qa-matrix device row selection (currently checkbox = select that one env set):
  when the user picks a device (row group), set `qaMatrixState.deviceScope = {platform, device,
  osVersion?}`; call the deselect store's `clear()` for stale entries ONLY when the device key
  changes; recompute `selectedEnvIds = defaultSelectionForDevice(...)` minus user's in-session
  deselections; re-render browsers + summary.
- Summary region `#qa-test-on` + `#qa-matrix-summary`: show device name, manufacturer, OS + version,
  orientation, count of browsers selected (e.g. "Samsung Galaxy A15 · Android 13 · 6 browsers").
- Keep `qase.qaConfigDeselections` persistence for the no-device-scope (full matrix) mode; when a
  device scope is active, deselections are session-scoped and reset on device change (per requirement).

## Acceptance criteria (running app)
- [ ] Picking Samsung Galaxy A15 in the modal auto-checks ALL compatible browsers (Chrome, Edge, Firefox, Opera, Brave — and DuckDuckGo only if actually available for it).
- [ ] The summary shows device name, manufacturer, OS/OS version, orientation, browser count.
- [ ] Switching from device A to device B unchecks A's browsers and auto-checks ALL of B's compatible browsers.
- [ ] Manually deselecting a browser works; changing device restores auto-select-all for the new device.
- [ ] No device scope active → behavior unchanged (full-matrix default all-AVAILABLE-selected).

## Tests
- qaConfigMatrix unit: defaultSelectionForDevice returns exactly the device's AVAILABLE envIds; family set excludes unsupported.
- app-level: device change clears prior scope's session deselections.

## Edge cases
- Device with zero AVAILABLE browsers → summary shows honest "No executable browsers" and Start stays disabled.
- DuckDuckGo mobile rows that are AVAILABLE must be included; NOT_SUPPORTED families never checked.
