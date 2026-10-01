# Phase D2 — Device Runtime Manager: States, Fallback, Busy/Queue

## Goal
Honest reservation lifecycle; never a silent REAL→SIMULATED downgrade.

## Changes
- `server/deviceRuntime/manager.js`: expose full state machine AVAILABLE, RESERVING, CONNECTING, CONNECTED, RUNNING, COMPLETED, FAILED, OFFLINE, BUSY, RELEASING via API; per-device FIFO queue with position.
- On real-device reservation failure: return structured `{ status: 'REAL_DEVICE_UNAVAILABLE', reason: offline|busy|unsupported|runtime_unavailable, queue_position }`. UI shows "REAL DEVICE UNAVAILABLE" + reason + explicit buttons [Retry] [Choose another device] [Run as Virtual Device] — user must click a fallback; no auto-switch.
- Busy device: modal "DEVICE BUSY · <model> · Current session RT-XXXX · Queue position N" with [Queue test] [Choose another device].
- Wire the null real-device provider to report honest "REAL DEVICE RUNTIME — Not connected" when no hardware/remote runtime is configured.

## Files
server/deviceRuntime/manager.js, server/deviceRuntime/nullRealDeviceProvider.js, server/app.js (runtime routes), public runtime UI (drawer/run panel), new public component for fallback dialog.

## Acceptance
- [ ] Unavailable real device shows NOT AVAILABLE / REAL DEVICE UNAVAILABLE with a reason; no fake execution
- [ ] Fallback to virtual/simulated only happens after an explicit user click
- [ ] Busy device shows BUSY with queue position and never silently switches devices
- [ ] With no real runtime connected, all devices report REAL DEVICE: Unavailable honestly

## Tests
Unit: state transitions, queue position, fallback refusal without user choice. E2E: select unavailable device → NOT AVAILABLE; simulate busy → BUSY modal.
