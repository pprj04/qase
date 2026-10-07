# QASE-2.1 layout gotchas (public/styles.css)

- The app is `<body class="cli-theme">`; the terminal-theme overrides (`.cli-theme …`, ~line 4978–8380) beat the base component styles. Check BOTH layers when styling.
- `.modal` (dialog) is the width owner: base `width:min(600px,calc(100vw-28px)); overflow:hidden`. Sizing only `.modal-inner` does NOT widen the dialog — size the dialog itself (see `.dm-modal`).
- `.modal-body` is `display:grid` WITHOUT `grid-template-columns` — wide children (coverage matrix with 990 env columns → 221,000px) expand the track to max-content and blow out the pane. Any modal with wide tables needs `.modal-body { grid-template-columns: minmax(0,1fr) }` + `min-width:0` on panes. Fixed for `.dm-modal` (ticket #13833).
- Modal / DM tab bars inherit `.cli-theme .tab` (9.5px, square, `·` prefix) unless `.dm-tabs .tab` overrides — tabs inside modals share the same classes as the main right-panel tabs.
- Narrow-rail device panel (Phase D5, #13802): desktop rail is 46px wide, so `.feature-dock > .feature-device` collapses to a launcher that opens the device drawer; full panel only at ≤1280px width (154px row) where `.device-chip-rows { display:flex }` is restored.
- Duplicate navigation: sidebar "Environments" button now routes to Device Matrix (`openDeviceMatrixButton.click()`); the old Apple-only #environments modal is kept but not routed by default.
- Auth gate: tests/Playwright need login (creds in /workspace/.drytis/cred.json, tester@qase.dev) before #open-device-matrix etc. are visible (.app is display:none until authed).
