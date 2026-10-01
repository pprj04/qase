# Ticket #14102 — Remove CHOOSE DEVICE strip + quick actions; picker-only device change (DONE)

Branch NIHARIKA, uncommitted. User request 2026-10-01 with screenshot: remove the bottom CHOOSE DEVICE strip and quick actions; fix 'change section of devices not rendering correctly'.

## What changed
- index.html: deleted #choose-device section + #quick-actions block. Right panel now: head (header + CURRENT TEST DEVICE card) → #stage → #tabs → .tab-body.
- styles.css: .choose-device/.cd-*/.quick-actions/.qa-* rules removed; .chat grids 7→6 rows, .viewer grids 5→4 rows at ALL variants (base 638, viewer 1634, cli-theme 5156, ≤1023 stacked, ≤520; also fixed stale 5-track rules at 2996/6179 that left a dead ~140px trailing track — reviewer WARN).
- app.js: chooseDeviceUi controller (~350 lines) + quickActions wiring + now-dead runAllTests/runFailedTests/createBugReport/loadSessionsForFilters removed; imports pruned; renderAllTestOnBlocks no longer calls renderChooseDeviceSummary; refreshDevicePickerData dropped cdRenderOnData calls. Device entry points now ONLY: card [Change Device]/[Choose device] → devicePicker.open().
- rightPanelContract.test.js: quick-actions behavior test → removal-contract test.
- test-acceptance.mjs: T7/T8/T16*/T17* retargeted to card-button → picker flow (T16 = strip-gone + order; T16b = selection updates card+header+stage; T17a–d picker-driven frames + reload).
- test-ui-responsive.mjs: cd-form-expanded → strip-gone checks at 1920/1024.

## Verification
Tester PASS 11/11 (no strip/chips/selects visible, order correct, no page scroll, picker fully rendered 88 cards no clipping at 1024×768, iPad/Windows stage CSS vars update, empty-state flow, console clean post-login). Reviewer PASS 7/7 after the grid-track fix. Suites: public 99/99, npm test 830/0/9, test:ui PASS, test:acceptance PASS (T17b soft-skip: no iPad Pro in catalog — tablet frame only live-verified).

## Open notes
- Picker does NOT auto-close after [Select] — tester flagged as UX gap; pre-existing behavior, needs customer decision.
- environmentsForPreset/buildBugMarkdown remain in qaWorkflows.js with no production consumer (dormant).
- #14076 (open) overlaps old Phase 2 scope — should be closed as superseded by #14102.
- The earlier #14077-era 'rendering not correct' complaint: root cause was the inline strip's own form; removal + picker flow verified clean.