# Browser test — Device Picker (ticket #13905) — 2026-09-30

**Verdict: FAIL (3 of 9)** — blocking JS bug in `onSelect` wiring.

## Blocking bug
`app.js:4577` — `onSelect` calls `applySessionSnapshot(state.sessions.get(state.activeSessionId))` but global `state` (app.js:134–169) has **no `sessions` or `activeSessionId` properties**. TypeError thrown on EVERY selection change (`reselect` → `onSelect` at devicePicker.js:300, before `renderSummary()`/`renderCards()` run).

Consequences:
- Card never visually changes to "Selected ✓" at click time; summary stays "SELECT A DEVICE".
- Browser-change and device-change re-resolution update the store (localStorage correct) but visible UI does NOT update.
- UI only becomes correct after reload + reopen (hydration path devicePicker.hydrate → renderSummary, no onSelect involved).

Store/legacy sync itself works: `qase.activeTestEnvironment` and `qase.environmentId` always match the latest pick (ENV-IOS-IP17PRO-26.0-SAF-26.0 after Safari switch, ENV-AND-PIXEL10-16-CHR-138 after Pixel 10 pick).

## What passed
- Quick Action "☰ Devices" opens `#device-picker` dialog (TEST ON DEVICE), not the old drawer.
- Header, search, platform chips [All][Apple][Android][Windows], type chips [All types][Phone][Tablet][Desktop], groups APPLE/ANDROID/WINDOWS, cards with name + "OS · Browser" + "● SIMULATED · AVAILABLE" badge + [Select].
- Platform filter Apple → only APPLE group (196 nodes, no Galaxy/Pixel/Windows); All restores.
- Hydrated summary text: `SELECTED: iPhone 17 Pro · iOS 26.0 · Chrome 138 · REAL DEVICE · 402x874 portrait · Touch / Camera / Microphone / Screen / Orientation`; Pixel 10: `Android 16 · Chrome 138 · REAL DEVICE · 390x844 portrait · …`. Browser dropdown for iPhone 17 Pro: Chrome 138/139/140/141, Safari 26.0 (OS dropdown Android 16/15 on Pixel 10).
- Persistence across reload: PASS (iPhone 17 Pro then Pixel 10 both re-selected after reload).

## Minor observations
- Card badge says "SIMULATED · AVAILABLE" while summary says "REAL DEVICE" (badge = board attestation neutral fallback; summary = env record). Matches reviewer WARN.
- Old drawer still reachable via `#device-chip-change` (reviewer WARN 1) — not in test scope.
- Login-boot: first page load fired 4×401s (`/api/auth/me`, `/environments`, `/device-runtime/devices`) before the auth cookie existed; on reload-with-cookie, 0 console errors.
