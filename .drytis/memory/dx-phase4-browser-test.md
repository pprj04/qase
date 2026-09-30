# DX Phase 4 browser test (ticket #13908) — FAIL 3/8

Preview tested 2026-09-30. AC7/AC8 chip lists render but are functionally dead. Three distinct JS bugs:

1. **app.js:4265 — TDZ ReferenceError `Cannot access 'devicePicker' before initialization`.**
   Phase-4 wiring IIFE (L4263–4271) runs during module init and polls `devicePicker`, but
   `devicePicker` is declared with `const` at app.js:4576 — later in the file. The loop's first
   read throws immediately → the IIFE dies → `setPickerHost` is never called on any chip list
   → **[+ Add device] buttons do nothing in all three surfaces** (test case form, bulk wizard
   "Pick environments", run-target "Choose devices"). Picker never enters ADD MODE.
   Note: comment says "poll until the instance exists" but `!devicePicker` read is itself the
   TDZ violation. Fix: move the IIFE after the devicePicker declaration (or use a promise/callback).

2. **testCaseView.js:218 — `formEnvironments is not defined`** in `openEditor`. Legacy select
   removed from markup but the reference at L218–221 (`if (formEnvironments) {...}`) was left
   in; throws on every openEditor call (dialog still opens because throw is inside the handler
   after form fields set, but breaks Edit prefill path).

3. **bulkRunView.js:99 — `deviceList is not defined`** in `resolvedPairs` → `renderPreview`.
   Selecting "Pick environments" throws; step-3 Summary renders empty (no "N tests · N devices ·
   N executions" text). Wizard dead-ends.

What DOES work: chip-list markup ("No devices yet — add one." + [+ Add device], no legacy
multi-select `#bulk-envs`/`#tc-environments` anywhere); creating a test case without chips
(TC-0035 created, 201, appears in table with Platforms "—").

Also: created test case TC-0034 "Phase4 chip test — homepage smoke" existed from prior run.
