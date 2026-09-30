# DX Phase 1 review (ticket #13905) — ONE Device Picker + activeTestEnvironment

Spec: `.drytis/specs/device-ux-phase-1.md`. Result: PASS with 3 WARNs (no FAILs).

## What was reviewed
- `public/activeTestEnvironment.js` (+test): store persisting `qase.activeTestEnvironment`, syncing legacy `qase.environmentId`, `resolveForEnvironment` canonical shape. Solid, tested.
- `public/devicePicker.js` (+test): pure helpers (`buildDeviceCards`, `rankEnvironments`, `resolveDeviceEnvironment`, `filterDeviceCards`, `cardBadge`) + `createDevicePicker` DOM dialog. Badges honest (board `maximumLevel` only). All DOM via createElement/textContent — no XSS surface.
- Wiring in app.js ~L4560–4602: `activeTestEnvStore` + `devicePicker`, hydrate from `persistedEnvId()` on boot, board map built from `/device-runtime/devices` (envId → {status, maximumLevel}), `onSelect` syncs drawer `state.defaultEnvId` + paints chip. Quick action `qa-choose-devices` → `devicePicker.open()` (app.js:4466). Suite: 809 pass / 0 fail / 9 skip.

## Known WARNs (open, not fixed by reviewer)
1. **Change button still opens the OLD device drawer** — `#device-chip-change` (deviceDrawer.js:564) and `#ldv-change-device` (app.js:4635-4640) → `deviceDrawer.open()`, not the picker. Spec Files section said "picker opens from Change + quick action". Only the quick action was rewired.
2. **dp-summary omits executionType/availability** — `renderSummary` (devicePicker.js:216) shows device/os/browser/resolution/orientation/capabilities but not `executionType` or availability, even though `selectionSummary` computes executionType. AC1 wording wanted honest execution/availability in the summary; card badges do show it.
3. **Browser dropdown not filtered to device+OS** — `renderCardOptions` lists `card.browsers` (all browsers across the device's envs, any OS). Spec L4 wanted "browser list filtered to existing active envs for device+OS". Consequence: picking a browser that has no env at the selected OS silently falls back to the device's overall best env (`resolveDeviceEnvironment` fallback, devicePicker.js:117-121); UI self-corrects (select re-reads store) but the user's OS choice can silently change.
4. (minor) Picker env data fetched once at boot only (app.js:4583) — goes stale if environments change mid-session; drawer refresh does not feed the picker.

Not a duplicate state violation: `devicePicker.state.selectedDevice` is ephemeral UI state (which card is expanded), re-derived from the store on open; drawer `defaultEnvId` is the documented legacy-compat channel the store keeps in sync. Run dialogs still seed from legacy `qase.environmentId` (populateEnvironmentSelect), which the store syncs — chain works.
