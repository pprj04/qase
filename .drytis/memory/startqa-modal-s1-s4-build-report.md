# Start-QA modal overhaul — S1–S4 build report (#15162–#15165, all Done)

## What shipped
- **S1 honest availability (#15162)**: `resolveBrowserSupport`/`Sync` (server/browserSupportResolution.js) no longer return NOT_SUPPORTED for "Binary present but failed to launch" probe entries — they return SUPPORTED with `launchVerified:false` + `probeNote`. `toConfiguration` (server/qaConfigurations.js) surfaces `launchVerified`/`probeNote` in browserSupport. Live: chrome/edge/firefox/opera/brave AVAILABLE, duckduckgo honestly NOT_SUPPORTED.
- **S2 device scope (#15163)**: new helpers in public/qaConfigMatrix.js — `configurationsForDevice`, `compatibleBrowserFamilies`, `defaultSelectionForDevice`, `deviceScopeSelection`. In app.js: `qaMatrixSetDeviceScope` (clears session deselections on device-key change), `qaMatrixEffectiveSelection`, clickable device rows (click/Enter/Space) with `.is-scoped` highlight, family checkboxes scoped to the device, summary line "<Device> · <OS> · <orientation> · N browsers · K configs". Verified against live index: Galaxy A15 → 146 configs (brave/chrome/edge/firefox/opera), iPhone 15 Pro Max → 222 incl. safari, nonexistent → 0.
- **S3 one configuration (#15164)**: QA modal "Change device" scrolls/flashes to in-modal `#qa-matrix-fieldset` (no more #device-picker redirect). `renderTestOn('qa-test-on')` mirrors matrix selection (device scope label or "Full device matrix · N configurations"). SQA/Founder keep the picker (they have NO matrix fieldset — only #qa-start does).
- **S4 gating/execution (#15165)**: syncQaSubmitState already gates on URL+selections; POST /api/qa-matrix-runs fans out one item per config (MAX_MATRIX_CONFIGURATIONS 2000 cap, unknown envIds → honest BLOCKED). 122 tests green incl. matrixApi 7/7 (previously wedged by infra).

## Gaps / not visually verified
- Browser-based UI verification of S2/S3 could not run: the tester member was absent from the roster this session and the container spent hours in fork-exhaustion. Scope logic verified against the LIVE API index with the real client module (imported public/qaConfigMatrix.js over fetched /api/qa-configurations?index=1), and served app.js/css confirmed to contain the wiring. Visual/responsive pass (375/768px) still outstanding — next session should run the tester journey from the S2/S4 review briefs.

## Session hazards
- Container repeatedly hit "fork: Resource temporarily unavailable" for hours; /tmp logs and the container itself were lost mid-run (mx5/mx6 logs vanished). All work survived via the 54199bf checkpoint + DEV merge by git_manager.
- matrixApi.test.js passes when the container is healthy (7/7) — the long wedges were infra (spawn exhaustion), not code. See .drytis/memory/matrixapi-node-test-wedge.md.
