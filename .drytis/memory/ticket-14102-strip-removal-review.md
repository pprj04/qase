# Ticket #14102 review — CHOOSE DEVICE strip + quick actions removal (branch NIHARIKA, uncommitted)

RESULT: PASS overall (matches tester's 11/11 live PASS). Deletions clean; all four suites green.

Key findings:
1. Dead-code grep clean: no `#cd-*`, `choose-device` (except `#ldv-choose-device`, the NEW empty-state button), `quick-actions`, `qa-run-all` etc. in public/. Only refs are the removal-contract test + explanatory comments.
2. One picker entry surface confirmed: card [Change Device]/[Choose device] → `devicePicker.open()`. Other picker openers (qa-start/SQA/founder Test-on change, test-case/bulk Add-device add-mode, device drawer, `#ldv-change-env` unavailable state) all open the SAME #device-picker — by design.
3. Grid templates: base + cli-theme desktop `.chat` (6 rows) / `.viewer` (4 rows, pinned head1/stage2/tabs3/tab-body4) consistent. WARN: at ≤520 `.cli-theme .viewer` (styles.css ~6174) still declares 5 tracks (`auto auto minmax(180px,40dvh) auto minmax(140px,1fr)`) for 4 children → ~140px dead trailing track measured live at 480px (viewerBottom 1795 vs tab-body bottom 1654). Also ≤1023 base `.viewer` 5-track rule (styles.css ~2996) is inert (overridden by `.cli-theme .viewer` 4-track via specificity) but inconsistent. Cosmetic; stacked mode scrolls anyway; suites only cover ≥1024.
4. `.qa-device-fieldset`/`.qa-landscape` CSS rules look like leftovers but belong to the #qa-start dialog (still in HTML) — NOT orphaned.
5. Tests retargeted coherently: rightPanelContract removal-contract; acceptance T7/T8 → card-button open, T16 → strip-gone + order, T16b/T17a-d → picker-driven card/header/stage + reload persistence; responsive strip-gone checks at 1920/1024. T17b (iPad) soft-skipped — no iPad Pro in catalog.
6. Suites: node --test public 99/99; npm test 830 pass/9 skip/0 fail; test:ui PASS; test:acceptance PASS (no throttle restart needed).
7. Unlisted-in-summary changes (scope note): `viewForSelection()` added to activeRuntimeEnvironment.js (+33, pure frozen view-model driving header/frame from store while idle — used at app.js:693) and `resolveDeviceEnvironment` gained an `executionLevel` filter param (devicePicker.js). Both benign, no sinks, support the card→preview update contract.
8. `environmentsForPreset`/`buildBugMarkdown` still exported from qaWorkflows.js with tests but no production consumer now — dormant library code, minor.
9. Tester note (pre-existing, not this ticket): picker does not auto-close after Select in select-mode; only add-mode intentionally stays open. Escape/Close works.
