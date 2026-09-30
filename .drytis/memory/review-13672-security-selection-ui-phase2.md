# Review — ticket #13672 Phase 2 (test-selection UI: Security category, tri-state, unavailable labels)

Verdict: PASS all 8 criteria, 0 FAIL, 2 WARN (both minor, no defects).

- Suites: `node --test qaUiSelection securitySelectionUi qaTestSelection app securityCatalog agent` → 86 pass / 0 fail. Browser verification by tester: 10/10 PASS (tri-state, bulk, 12-of-12 count excluding unavailable, persistence).
- Working tree is uncommitted on top of merge commit 3f0d437; styles.css diff is purely additive (0 deleted lines), index.html one line changed (qa-submit label "Start QA run" → "Start test").
- Key implementation facts: unavailable checks ARE rendered as disabled inputs (not omitted); safety comes from `qaSelectableInputs`'s `:not([disabled])` filter + Phase 1 server-side rejection. `qaTestOption` uses textContent only; securitySelectionUi.test.js asserts no innerHTML in the block.
- WARN: openQaStart's `qaUi.form.reset()` resets checkboxes to defaultChecked (all-available), then paintQaTestCatalog re-renders — meaning "persistence" only holds within one dialog session (per spec), and dialog reopen resets to all-available default. Intentional per spec wording ("grid never re-rendered on dialog open" = within-open persistence).
- WARN: `.sqa-option.is-unavailable:has(input:checked)` CSS is dead defensive styling (disabled inputs never get checked) — harmless.
- Phase 3 note from spec: security-authorization confirmation UI section is laid out in a later phase; only catalog/category UI shipped here.
