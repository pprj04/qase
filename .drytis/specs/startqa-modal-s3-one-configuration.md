# Phase S3 · One configuration — dedupe selection flows

## Goal
All device/browser configuration for a QA run happens in the Start QA run modal. No redirect.

## Files
- `public/app.js`:
  - `qaUi.testOnChange.onclick` (:5526, :5830, :5990 for QA/SQA/Founder) — instead of
    `devicePicker.open()`, focus/scroll to `#qa-matrix-fieldset` inside the same modal (single
    source of truth). Keep label "Change device".
  - `#qa-test-on` summary becomes a reflection of `qaMatrixState.deviceScope` / matrix selection
    (sync in the same render pass as `qaMatrixRender`).
  - Submit (:5613–5707): when deviceScope active, sanitize against the scoped set; POST
    `/api/qa-matrix-runs` as today with the scoped `configurationEnvIds`. No `/api/sessions` path.
- `#device-picker` dialog and `activeTestEnvironment` store remain untouched for OTHER flows
  (run screen live view, bulk runs) — only the Start-QA path stops routing through it.
- `#qa-environment-select` (Apple remote runtime override, index.html:763) stays as-is under
  Advanced device options (explicitly not a duplicate: it selects a remote provider environment,
  not the local device matrix).

## Acceptance criteria (running app)
- [ ] Clicking "Change device" in Start QA run never opens another dialog/page; the in-modal matrix is highlighted and usable.
- [ ] The TEST ON summary always matches the matrix selection (device or full-matrix counts).
- [ ] Starting a run uses exactly the envIds shown as selected in the modal.
- [ ] The standalone device-picker dialog still works for its other consumers (no regression there).

## Tests
- grep-level assertion: no `devicePicker.open` in the qa-start/SQA/Founder handlers.
- Manual: full journey open → URL → device → auto browsers → Start.

## Edge cases
- SQA and Founder modals share the TEST ON fieldset markup — apply the same in-modal behavior there
  or keep their picker if they have no matrix; do not break them (record which was done).
