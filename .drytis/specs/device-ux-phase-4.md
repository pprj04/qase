# DX Phase 4 · Test cases & bulk runs: Add device via the picker

## Goal
Drop environment multi-selects (Ctrl/Cmd-click) in favor of [+ Add device] chips using THE picker.

1. Test case form: replace #tc-environments multi-select with 'TEST ON DEVICES' chip list (chip = device + os/browser summary + remove ×); [+ Add device] opens picker in add-mode. Submit sends the same environmentIds array (API unchanged).
2. Bulk wizard step 2: replace #bulk-envs multi-select with the same chip pattern; assigned/default modes remain, 'pick' uses the picker; the 'N devices · N cases · N executions' summary derives from chips; launch posts the same pairs.
3. Picker add-mode (onApply appends envId) vs select-mode (sets active selection) — same component.

## Files
public/testCaseView.js, public/bulkRunView.js, public/app.js, public/index.html, public/styles.css.

## Acceptance criteria
- [ ] Test-case create uses [+ Add device] → THE picker; environmentIds unchanged.
- [ ] Bulk wizard uses chips; counts correct; launch per-pair unchanged.
- [ ] No Ctrl/Cmd-click multi-select in the primary flows.
- [ ] Existing suite green.
