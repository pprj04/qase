# DX Phase 2 · One selection surfaced everywhere + affordance routing

## Goal
Every displayed location reads activeTestEnvironment; every change affordance opens THE picker.

1. Right card (#ldv-env-card): 'CURRENT TEST DEVICE' when idle / 'LIVE DEVICE' running; device/os/browser lines; exec + status badges; [Change] → THE picker. Device-chip rail's Change also opens THE picker (one mechanism).
2. Quick Actions: 'Devices' → relabel 'Target device', opens THE picker.
3. Sidebar: 'Device Matrix' relabeled 'Device management' (admin/catalog entry — opens the existing matrix modal); no second selection UI in the primary workflow.
4. Selected-environment summary (device · os+version · browser+version · execution badge · availability · capabilities line) in picker footer + right card; updates immediately on change.
5. Empty state (AC11): no selection → card shows 'SELECT A DEVICE [Choose device]' opening THE picker. Remove the environments[0] silent default seeding at app.js ~4603-4607.

## Files
public/app.js, public/index.html, public/styles.css, public/deviceDrawer.js.

## Acceptance criteria
- [ ] Change (right card), Target device (quick action), Choose device (empty state) all open the same picker.
- [ ] No duplicate device/env state between components.
- [ ] No silent default device.
- [ ] Existing suite green.
