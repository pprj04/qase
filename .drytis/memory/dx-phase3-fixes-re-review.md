# DX Phase 3 fixes re-review (ticket #13907) — RESULT: PASS

Spec: `.drytis/specs/device-ux-phase-3.md`. Sanity: procmgr all RUNNING, curl localhost:5173 → 200. Suite: 820 tests, 811 pass / 0 fail / 9 skip.

## Verified fixes
1. SQA Change device wired: `openSqaStart` app.js:3449–3450 (`renderTestOn('sqa-test-on')` + `sqaUi.testOnChange.onclick = () => devicePicker?.open?.()`).
2. Founder Change device wired: `openFounderStart` app.js:3612–3613 (same pattern for `founder-test-on`). QA was already wired (3274, 3281).
3. All three dialogs render their own TEST ON block at open → self-healing (WARN 1 resolved).
4. `populateEnvironmentSelect` / `populateDeviceSelect` deleted — zero references anywhere; the divergent `qase.environmentId` write path is gone. No other `localStorage.setItem('qase.environmentId')` in app.js (deviceDrawer.js legacy writes remain — pre-existing, Phase 2-documented).

## Remaining WARNs (non-blocking, cleanup)
- `envOptionGroups` (app.js:551) and `envLabel` (546) now have **zero callers** — dead code, worth deleting.
- `pendingEnvironmentId` (584) also has zero callers — dead. Same for `deviceSelect: null` legacy entries (3341, 3557) and `el.deviceSelect` (`#device-select`, app.js:39 — element absent from DOM, loadDevices early-returns at 516).
- Carried: drawer "Set default" writes `qase.environmentId` directly (deviceDrawer.js:495); Phase 1–3 uncommitted on branch PUSHKAR.
