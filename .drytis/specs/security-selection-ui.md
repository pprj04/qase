# Phase 2 — Test-selection screen: Security category, tri-state, unavailable labels

Goal: grouped test-selection UI with a "Security testing" category, default-selected
available checks, per-category tri-state, bulk controls that include security options,
and clear labeling of unavailable checks. Studio design reuse, safe DOM construction.

## UI (public/index.html, public/app.js, public/styles.css)
- Render the catalog grouped by category: "Standard tests" (existing grid) and
  "Security testing" (new section) inside the existing `#qa-tests-fieldset`.
- Category header: label + checkbox driving tri-state (all checked → checked; none →
  unchecked; mixed → indeterminate). Toggling it selects/deselects the whole category.
- Default on dialog open: all available tests checked (standard 8 + security 4);
  unavailable checks (MITM, DoS) render **disabled, unchecked**, with their reason
  visibly attached (small muted text: "Not implemented — requires an agreed,
  configured … scenario") — clearly not selectable, never silently included.
- "Select all" / "Deselect all" operate on available checkboxes only (standard +
  security); unavailable stay disabled and labeled.
- Count `#qa-tests-count` reflects available selections ("11 of 12 selected",
  excluding unavailable).
- Individual security checkboxes remain individually toggleable; state preserved
  across device/landscape/URL edits exactly like standard tests (grid never re-rendered
  on dialog open).
- Start test disabled at 0 available selections — unchanged logic.
- Security authorization UI (a confirmation that the target is an explicitly
  authorized, isolated test environment, with scope/notes fields) — wiring lives in
  Phase 3, but the section container is laid out here to Studio spec.

## Design reuse
- Same `.sqa-fieldset` / `.sqa-option-grid` / `.sqa-option` system; new additive
  classes only (`.qa-category`, tri-state styles, `.sqa-option.is-unavailable`).
- No innerHTML — safe DOM construction like `qaTestOption`.

## Acceptance criteria
- [ ] Dialog shows both categories; Security testing lists all 6 checks.
- [ ] Available security checks are checked by default; MITM and DoS are visibly disabled with their reasons.
- [ ] Category tri-state shows checked / unchecked / indeterminate correctly as individual boxes change.
- [ ] Select all / Deselect all cover both categories' available checks; unavailable stay untouched.
- [ ] Count and Start-test gating reflect only available selections.
- [ ] Selections persist across configuration edits.

## Tests
- Extend `server/qaUiSelection.test.js` static contract tests (grouped rendering,
  tri-state wiring, disabled unavailable options, bulk control scope).
- Browser test via tester member on the preview (default selection, tri-state,
  bulk controls, disabled unavailable, persistence).

## Edge cases
- Catalog load failure → security section hidden, submit disabled (existing failure path).
- Old cached catalog (max-age 300) vs new UI — UI derives purely from API payload.
