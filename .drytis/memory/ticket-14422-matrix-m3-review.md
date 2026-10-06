# Ticket #14422 (Matrix M3 — sidebar UI) code review

Round 1: PASS 7/8, FAIL (add-mode bypass), 4 WARNs.
Round 2 (current): **PASS — FAIL fixed, WARN 1/3/4 fixed. WARN 2 (recents record()) deliberately deferred to M4, unchanged.**

## Round-2 fixes verified (code + tester 6/6 live PASS)
- FAIL fixed: app.js onSelectDevice (line ~6379) now routes through
  `devicePicker.selectEnvironment(env)`. devicePicker.js:521 selectEnvironment sets
  state.selectedDevice and calls `reselect({osVersion: env.osVersion, browser: env.browser})`
  — the exact card path. reselect (line 374) honors `state.addPick(env)` first (append,
  dialog stays open, store untouched) else store.setSelection + onSelect + repaints.
  Both sidebar render paths (row click line 138, OS chip line 71) go through it.
  All onSelect side effects (drawer defaultEnvId, paintChip, applySessionSnapshot,
  header repaint, renderAllTestOnBlocks) now run for sidebar picks too.
- WARN1 fixed: two-way sync — app.js onSelect calls `matrixSidebar.setSelection(selection.device,
  selection.osVersion)`; onOpen re-syncs from activeTestEnvStore.get() (line 6366).
- WARN3 fixed: matrixSidebar.js:39 deviceEnvFor now `rankEnvironments(selectedOS-subset or all)[0]`
  (rankEnvironments imported from deviceBrowserMatrix.js, which re-exports it from
  devicePicker.js — a real named export, line 398). Attested REAL_DEVICE preferred, then
  OS freshness; never raw catalog order.
- WARN4 fixed: comment now "Same ranking as the card path … never raw catalog order".
- No infinite loop: sidebar setSelection (matrixSidebar.js:237) only assigns state + render();
  it never calls onSelectDevice. reselect → onSelect → setSelection → render terminates.
- Minor note: resolveDeviceEnvironment fallback (browser/os combo missing → device's best)
  is unreachable from sidebar picks because deviceEnvFor only returns an existing env of
  the device, so the osVersion+browser filter always matches ≥1 row. Belt-and-braces
  `devicePicker.state.selectedDevice = device` in onSelectDevice duplicates what
  selectEnvironment does — harmless redundancy.
- Recents: matrixRecents still instantiated read-only; `record()` not yet called (M4
  write-through scope). No regression.
- Suite: 1146 tests / 1126 pass / 0 fail / 20 skip reproduced; node --check clean on
  app.js, devicePicker.js, matrixSidebar.js.

## Round-1 verified PASS (unchanged)
6 categories + empty states; shared search; expand/collapse/tree a11y; hardware-gated
OS nav; stars add/remove/persist; tokens-only CSS (cache-bust 20261002-3); legacy card
list intact; CSP (no inline scripts); no innerHTML/eval/secrets; mx-columns scaffold hidden.
