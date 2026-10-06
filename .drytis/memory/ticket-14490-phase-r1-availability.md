# Ticket #14490 — Phase R1 · Honest availability baseline — DONE

- Catalog verified complete for the expansion request: 38,458 envs / 174 devices, all requested devices (iPhone 11–17 PM incl 16e/17 Air, iPads, macOS Monterey→Tahoe, all Android vendors, Windows+Surface) and all 7 browsers present. validate-matrix ALL PASSED. Nothing needed adding — R1 was the honesty layer only.
- server/environmentService.js: RUNTIME_PLACEHOLDER.runtimeStatus 'AVAILABLE' → 'UNAVAILABLE' (withExecutionMetadata no longer claims availability without a runtime board entry).
- server/deviceRuntime/manager.js seedBoard(): seeds board OFFLINE + unavailableReason when maximumLevel is SIMULATED-only (no REAL/VIRTUAL provider). Preserves BUSY/AVAILABLE from real providers. deviceBoard() rows now include unavailableReason. NOTE: deviceBoard is defined ONCE (line ~309); an accidental duplicate was added and removed — do not re-add.
- public/app.js refreshDevicePickerData(): board rows are FLAT per envId — fixed the old `device.environments` bug so board status actually reaches matrix/picker.
- Labels: OFFLINE now renders 'REAL DEVICE UNAVAILABLE' in matrixColumns.js (row meta), devicePicker.js cardBadge + selection summary (never defaults to AVAILABLE), deviceRuntimeUi.js AVAILABILITY_META.OFFLINE label 'Real device unavailable' (test updated).
- Live-verified (login accounts[0] cred.json): /api/device-runtime/devices → 41,374 board rows ALL OFFLINE with reason (providers: local-simulation, browserstack[no creds], null-real-device); envs availability=UNAVAILABLE.
- Suite 1159 pass / 0 fail / 20 skip; validate-matrix PASS; preview 200.
- Gotcha: `git fetch` plain hangs in this container — use `git -c protocol.version=2 fetch origin <branch>`.
