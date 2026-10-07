# #13784/#13785 D8 — acceptance script retargeted to matrix UI; 24/24 PASS

## What shipped (code change = test-only)
scripts/test-acceptance.mjs retargeted from legacy picker selectors (removed by M7 #14474) to the matrix: openPicker waits #mx-sidebar .mx-device (20s for 38k envs); T7 = sidebar device click → #mx-columns .mx-version click → #dp-summary OS assertion; T8 = .mx-col aria-label brand enumeration (all 7 brands); T16b/T17 pickDevice/pickFor = sidebar device → first .mx-version:not([aria-disabled]) → Escape. Live run: 24/24 PASS (incl. T7 summary 'iPhone 17 Pro Max · iOS 26.0 · Chrome 156 · VIRTUAL DEVICE · AVAILABLE', T17b iPad Pro 11 tablet frame, T17d reload persistence). Full suite 1156/1136/0/20. #13785 closed as literal dup of #13784.

## WARNs (documented, not fixed)
- T7 regex /OS/i near-tautological (pre-existing).
- T17c has no null-skip branch (T17b does) — pre-existing.
- test:acceptance is manual-only; no CI selector-contract guardrail — drift can re-occur silently. Candidate future improvement.
- #ldv-choose-device dead fallback selector kept in openPicker (harmless legacy).

## Run command
QASE_TEST_PASSWORD=$(python3 -c "import json; print(json.load(open('.drytis/cred.json'))['accounts'][0]['password'])") node scripts/test-acceptance.mjs   # ~60s, needs live app

## Remaining stale Open tickets
- #14076 Exec Panel Phase 2 Choose Device form [high] — suspected dup of done #14075.
- #14103 [urgent] remove CHOOSE DEVICE strip — DONE via #14102/#14132; close as dup (T16 asserts strip gone, PASS).
- #14120 collapsible CURRENT TEST DEVICE card — card REMOVED by #14132; T18 asserts card+toggle gone, PASS; likely obsolete — verify then close.
