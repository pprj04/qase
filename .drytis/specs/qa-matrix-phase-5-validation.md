# Phase 5 — Validation suite, regression & honest coverage report

## Goal
Prove the feature end-to-end, guard regressions in the preserved flows, and produce an
honest statement of implemented execution vs unavailable coverage (provider setup still
required).

## Work
- End-to-end smoke (scripts/, `node --test`):
  1. `GET /api/qa-configurations` returns seven families + Android/Apple/Windows categories.
  2. Launcher default selection = all available configurations; deselection persists.
  3. Start a QA matrix run against the demo target with a small available config set
     (e.g. local Chrome branded + Firefox) → every item terminal with runtimeFacts;
     Chromium-engine items must NOT claim Brave/Edge/Opera brand.
  4. Cancel mid-run → remaining items Cancelled.
  5. Retry a failed item → fresh result.
  6. Totals + coverage gaps correct; evidence attached per configuration.
- Regression: existing engine fan-out API compatibility (`POST /api/sessions` unchanged),
  device picker, Bulk Runs wizard, Device Matrix admin, reports, SQA/Founder flows still pass
  (`npm test` suite green).
- UI acceptance sweep: matrix searchable/scrollable without clipping at 1920/1280/1024;
  loading/empty/error/retry states; Start gating.
- Documentation note (docs/ or README section): provider setup still required —
  BrowserStack credentials (`BROWSERSTACK_USERNAME`/`BROWSERSTACK_ACCESS_KEY`, currently
  not configured → iOS/Android REAL_DEVICE rows report "Not configured"), DuckDuckGo
  execution channel (none exists today — family visible, not selectable).

## Acceptance criteria
- [ ] The 6-point smoke passes against the running app.
- [ ] `npm test` green; no regression in preserved flows.
- [ ] A written coverage report distinguishes: executed locally (branded Chrome/Brave/
      Opera/Edge + Firefox + WebKit-engine), remote (BrowserStack, when configured), and
      unavailable (DDG, real Apple/Android devices without credentials) — with the exact
      reason strings surfaced in the UI.
- [ ] UI sweep findings fixed (clipping, clipping controls, sticky headers).

## Edge cases
- Smoke run with zero available configurations (all providers down) → honest empty start,
  Start disabled, no crash.
- Full-catalog selection (thousands of configs) → creation + pagination sane (bounded by
  catalog size; planner warns/limits with honest messaging when > a safety cap).
