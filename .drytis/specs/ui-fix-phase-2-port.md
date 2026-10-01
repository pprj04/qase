# UI Fix Phase 2 — Port device-picker & active-environment foundation from PUSHKAR onto NIHARIKA (P1)

Branch: NIHARIKA only. The DX/LDV work exists only on PUSHKAR checkpoint 104b297. Port the four additive modules + tests, then adapt wiring to NIHARIKA's structure.

## Source material (PUSHKAR, additive files)
- public/activeTestEnvironment.js (89 lines) — store + resolveForEnvironment, keys 'qase.activeTestEnvironment' + legacy 'qase.environmentId'
- public/devicePicker.js + devicePicker.test.js — buildDeviceCards/rankEnvironments/resolveDeviceEnvironment/filterDeviceCards/cardBadge/browsersForOS/executionTypeText/selectionSummary + createDevicePicker dialog controller
- public/activeRuntimeEnvironment.js (201 lines) + tests — resolveActiveRuntimeEnvironment view-model + runtimeStatusFor/executionTypeFor honesty rules
- public/browserChrome.js (48 lines) + tests — browserBrand metadata

## Changes
1. Copy the four modules + tests from PUSHKAR (`git show PUSHKAR:public/<file>`), add `<script>` tags to index.html (currently only entry.js/entry-motion.js/app.js at :934-936).
2. Adapt createDevicePicker wiring to NIHARIKA entry points (different from PUSHKAR): QA dialog #qa-start (#qa-device-select/#qa-environment-select :495-504), SQA #sqa-start (:594-603), Founder #founder-start (:707-716), right-panel/#device-chip-change, quick action #qa-choose-devices, run-target dialog #run-target. All open the ONE picker; environment selects become auto-resolved summaries (no separate environment dropdown).
3. activeTestEnvironment is the single source of truth: remove independent selectedDevice/selectedEnvironment/selectedBrowser state in dialogs; store init at app.js boot; no silent default environment (populateEnvironmentSelect currently seeds environments[0]).
4. Add `#device-picker` dialog markup + `.dp-*` styles to NIHARIKA's index.html/styles.css (the dialog markup was index.html-level, not in the modules — must be recreated; reference PUSHKAR diff).
5. Crash-fix carried from PUSHKAR: onSelect handler must guard with `state.session` (NIHARIKA state shape: state.session/state.sessionId — verify before reusing).
6. Execution-honesty: cardBadge/executionTypeText never claim REAL when unknown.

## Acceptance criteria (running app)
- [ ] Every device entry point (QA, SQA, Founder, right panel, quick action, run-target) opens the same device picker dialog.
- [ ] Selecting iPhone 17 Pro Max auto-resolves OS + default browser + resolution/orientation/executionType with no separate environment step and no environment IDs shown.
- [ ] Switching device then starting a QA run uses the resolved environment.
- [ ] If no device was ever selected, surfaces show 'SELECT A DEVICE' + choose affordance — never a silent default.
- [ ] Changing browser re-resolves the active environment everywhere the selection is shown.
- [ ] activeRuntimeEnvironment/activeTestEnvironment unit tests pass on NIHARIKA (ported).

## Tests
- Ported module tests; adaptation tests for NIHARIKA dialog wiring; browser test: select device → start QA → run carries resolved env.

## Edge cases
- localStorage keys from PUSHKAR sessions ('qase.environmentId') — legacy fallback must work; device catalog fetch failure → picker shows loading/error, not blank; browser list filtered by exact osVersion.
