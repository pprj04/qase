# UI Fix Phase 4 — Modals, tables, empty/loading/error states (P2)

Branch: NIHARIKA only, after Phases 1–3.

## Goal
Every dialog fits the viewport with scrollable body + Escape; device/environment tables scroll horizontally inside their container; contextual empty/loading/error states everywhere; run completion and session switching keep full context.

## Current state (NIHARIKA)
- Dialogs: #qa-start, #sqa-start, #founder-start, #test-cases, #bulk-run, #run-target, #device-matrix, #device-drawer, #environments, settings/account dialogs. NIHARIKA's #device-matrix modal had no known clipping fix (that was PUSHKAR #13833) — verify.
- Quick actions: #qa-run-all/#qa-run-failed/#qa-create-case/#qa-choose-devices→(Target)/#qa-view-results/#qa-create-bug (index.html:860-879).
- Bulk run wizard: #bulk-where, #bulk-envs multi-select (index.html:803-811); test cases: #tc-environments multi (index.html:759) — the Ctrl/Cmd-click multi-selects the request removes.

## Changes
1. Modal audit: base .modal max-height:calc(100vh - 40px), header/footer pinned, body overflow:auto; Escape closes (add where missing); keyboard nav. Known PUSHKAR fixes to re-apply if absent: #device-matrix width:min(960px,94vw), grid min-width:0 on panes; test-cases dialog body overflow:auto max-height min(820px, calc(100dvh - 32px)).
2. Test cases: replace #tc-environments multi-select with 'TEST ON DEVICES' chip list + [+ Add device] opening the ONE picker.
3. Bulk runs Step 2: replace #bulk-envs multi-select with DEVICES [+ Add device] chips + summary 'N test cases × M devices = K executions'.
4. Quick actions: 'Devices' relabeled 'Target' → same picker; keep Run all/Run failed/Test case/Results/Bug.
5. Empty states (each with next-action copy): Activity 'No activity yet', Plan 'No test plan generated', Findings 'No findings yet', Bugs 'No bugs detected', Report 'No report available', Device 'No device selected', Browser 'No browser connected'.
6. Loading states: 'Loading device catalog...', 'Checking device availability...', 'Resolving browser compatibility...', 'Connecting to device...', 'Starting browser...', 'Collecting evidence...', 'Generating report...' — replace generic 'Loading...'.
7. Error states rendered in-panel: DEVICE UNAVAILABLE card with reason + [Retry]/[Choose another device].
8. Tables (Device Matrix etc.): container overflow-x:auto, cells text-overflow:ellipsis + title tooltips.
9. Accessibility: labels on all inputs/buttons, visible focus ring, active tab aria-selected, status never color-only (text label present), scrollable regions focusable.
10. Code quality: remove dead markup (unwired #environments dialog remnants), unused layout CSS, conflicting fixed heights (audit the 144 `height:NNpx` decls for structural ones), duplicated state in dialogs.

## Acceptance criteria (running app)
- [ ] Every dialog opens within viewport, header/footer/action buttons visible, body scrolls, Escape closes it.
- [ ] Test cases & bulk runs use Add-device chips via the same picker; no Ctrl/Cmd-click multi-select remains.
- [ ] Each tab shows its contextual empty state when empty; device picker shows contextual loading then devices or error.
- [ ] A long device model name doesn't break layout — ellipsized with tooltip; tables scroll horizontally inside their container only.
- [ ] Completed run keeps device/OS/browser/runtime/result/evidence visible without reset.
- [ ] Keyboard: tab through QA dialog, focus visible, tab bar arrow-key navigation works, statuses readable without color vision.

## Tests
- Browser: open each modal at 1024×768 assert fits; test-case create with device chips; bulk run summary math; empty-state snapshot per tab; DEVICE UNAVAILABLE error path.

## Edge cases
- Very long URL/target strings; 990-environment coverage table regression (was PUSHKAR #13833); preview stream stall error; empty device catalog.
