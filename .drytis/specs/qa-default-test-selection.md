# Default-select all standard QA tests on the test-selection screen (ticket #13661)

## Summary
On the standard-QA start dialog (`#qa-start`), present the catalog of standard
QA tests with per-test checkboxes. All tests are checked by default, with
"Select all" / "Deselect all" bulk controls. Only the selected tests drive the
agent's test plan, and "Start QA run" is disabled while nothing is selected.
Founder Mode (its own launcher `#founder-start`) and SQA compliance (its own
launcher `#sqa-start`) stay separate optional choices — untouched.

## Files to change
- `server/qaTestCatalog.js` (NEW) — server-side source of truth for the
  standard QA test catalog: id, title, description, focus hint (plan guidance
  per test). Versioned like the SQA catalog.
- `server/app.js` — `GET /api/qa/catalog` (auth'd, private cache 300s) mirroring
  `/api/sqa/catalog`.
- `server/prompt.js` — `buildQaContext` accepts the run's selected test ids and
  renders a "Selected standard tests" section: instructs the agent to cover the
  selected areas in its `update_todo` plan and NOT to test areas whose ids are
  absent. When the selection is missing/empty, the current full-coverage text
  applies (legacy sessions unchanged).
- `server/app.js` `POST /api/sessions` — accept `selectedTests` (array of known
  catalog ids, bounded ≤32, all-unique); default `undefined` → full standard
  coverage (backwards compatible). Store on the session so both `store.js`
  (local) and `postgresServices.js` carry it.
- `server/store.js` — validate/persist `selectedTests` on the QA session
  (validate against the catalog; reject unknown ids).
- `public/index.html` — QA dialog gains a `Tests` fieldset: select-all /
  deselect-all header row, a `qa-test-options` grid (reuse `.sqa-fieldset`,
  `.sqa-option-grid`, `.sqa-option` classes), and the catalog-loading state.
- `public/app.js` — QA launcher:
  - fetch `/qa/catalog` (cached in `state.qaCatalog`), render checkboxes all
    checked by default,
  - individual checkbox change → re-sync submit state,
  - Select all / Deselect all buttons,
  - `qa-submit` disabled when 0 checked (or catalog failed / busy),
  - submit sends `selectedTests` in `POST /sessions`,
  - selection preserved: checkboxes live inside the form; device/landscape/URL
    edits never re-render the test grid (grid built only on open).
- `server/qaTestSelection.test.js` (NEW) — unit tests: catalog shape
  validation, request-body validation (unknown id rejected, dedupe, bound),
  prompt section generation, default-select semantics.
- `server/qaUiSelection.test.js` (NEW) — static source tests matching the
  existing `sqaUi.test.js` house style: dialog markup contains the fieldset,
  bulk controls, checkbox grid ids; app.js contains default-checked rendering,
  submit-disable logic, select/deselect handlers, `selectedTests` in the POST
  body, no `innerHTML` in the renderer block.

## Reuse / design
- Reuse `.sqa-fieldset` / `.sqa-option-grid` / `.sqa-option` styles and the
  `sqaCatalogOption` DOM-construction pattern (safe DOM APIs).
- Permission checks: launching a QA run remains behind the existing auth'd
  `POST /api/sessions` route — no new unauthenticated surfaces. Restricted
  actions keep their existing role checks (untouched).

## Acceptance criteria
- [ ] All standard tests checked when the QA start dialog opens
- [ ] Individual checkbox toggles exactly one test
- [ ] "Select all" checks everything; "Deselect all" clears everything
- [ ] "Start QA run" disabled when nothing selected, enabled otherwise
- [ ] Run executes only the selected tests (agent plan constrained by selection)
- [ ] Selection preserved while editing device / landscape / URL in the dialog
- [ ] Founder Mode launcher and SQA (compliance) launcher unchanged and optional
- [ ] Existing permission checks untouched (grep for role checks around
      restricted routes — no modifications)
- [ ] UI matches Studio's existing design (reuses sqa option classes)
- [ ] Unit tests + static UI tests green

## Tests
- Unit: catalog validation, selectedTests validation, prompt rendering.
- Integration: `POST /api/sessions` with/without `selectedTests`.
- Browser (tester sub-agent): S1–S8 from the ticket review brief — default
  selection, individual checkbox, bulk controls, submit disable, selection
  persistence, Founder/SQA independence, permissions, design match.

## Edge cases
- Catalog fetch failure → fieldset disabled, error shown, Start disabled.
- Legacy clients / API callers without `selectedTests` → full coverage run.
- Duplicate ids in request → rejected with 400 (no silent dedupe server-side).
- Very large arrays (>32) → rejected.
