# Phase B4 — End-to-end validation, regression & honest coverage statement

## Goal
Prove the whole chain against the acceptance checklist and produce the honest coverage
statement distinguishing real execution from unavailable coverage.

## Work
- Smoke (scripts/, node --test): (1) catalog shows all seven families with runner-sourced
  versions; (2) full supported set selected by default; deselection persists between
  dialog steps/reopens; (3) Start with a small local config set → every item terminal with
  real runtimeFacts (no Chromium item claiming Brave/Edge/Opera/DDG); (4) one browser
  failure leaves siblings PASSED (independence); (5) cancel mid-run; retry failed item;
  (6) results board shows required statuses incl. NOT RUN (deselected), NOT SUPPORTED (DDG),
  UNAVAILABLE (no provider); honest-pass guard green.
- Regression: TEST ON picker, Bulk Runs wizard, Device Matrix admin, Coverage tab,
  reports, SQA/Founder, existing engine fan-out API (`POST /api/sessions` unchanged),
  `npm test` suite green. UI unchanged in structure/styling — checklist extension only
  (screenshot diff on the QA dialog against pre-change baseline).
- Coverage statement (docs/ or report section): real execution today = branded local
  Chrome/Brave/Opera/Edge + Firefox + WebKit-engine (labeled engine-equivalent, NOT Safari);
  unavailable = real iOS/Android devices (BrowserStack unconfigured), DuckDuckGo (no runner);
  with exact reason strings as shown in the UI.

## Acceptance criteria (true in running app)
- [ ] The 6-point smoke passes.
- [ ] `npm test` green; preserved flows regression-free; QA dialog visual structure unchanged.
- [ ] Coverage statement written and accurate, distinguishing executed vs unavailable with reasons.
- [ ] The full 20-point acceptance checklist from the request is verified item-by-item.

## Edge cases
- Zero-available-config start → honest empty, Start disabled. Full-catalog selection →
  creation sane with honest safety cap messaging.
