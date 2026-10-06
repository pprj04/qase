# #13782 D6 bulk wizard — checkbox case list + step-3 availability shipped

## What shipped (real code, not just dup-verification)
1. index.html #bulk-run: legacy `<span>Ctrl/Cmd-click…</span>` + `<select id="bulk-cases" multiple>` REPLACED by checkbox list: #bulk-case-list (role=group), #bulk-cases-all "Select all", #bulk-cases-none "Clear all", #bulk-cases-count aria-live counter; step 3 gained #bulk-availability. styles.css bump v=20261002-7.
2. bulkRunView.js: state.chosenCases Set; renderCases() renders label.check.bulk-case checkboxes; casesForWhat 'selected' reads the Set; renderAvailability(pairs) — one row per device (device·OS·browser — env label from environmentsById, may fall back to envId if env missing), availability word (Available / Busy — will queue / Status unknown / raw), maximumLevel spaced-lowercase, per-device run count; dot class from RAW board status (is-available/is-busy/is-offline/is-unknown). refreshBoard() on every advance to step 3 via setRuntimeBoardFetch(fetchRuntimeBoard) injected in app.js. Zero-pairs branch also clears availability rows (round-2 WARN fix).
3. CSS .bulk-case-list/.bulk-case/.bulk-availability/.bulk-avail-* tokens only.
4. New public/bulkWizardContract.test.js (3 source-contract tests).

## Verification
Reviewer PASS round 1 (4 WARN) → fixed WARN1 (dot-class derivation) + WARN2 (stale rows) → round 2 PASS. Tester PASS 5/5 (237 cases, counter 0→237→0→2, step 3 row "ENV-IOS-… — Available · simulated · 1 run"). Suite 1154/1134/0/20. Accepted deviation: D6 spec said checkbox DEVICE selector — devices already chip-list (DX4); checkbox treatment applied to test cases instead.

## Dup-status of remaining stale Open tickets
- #13783 Phase D7 media tests — NOT yet verified, do not assume dup.
- #13784/#13785 Phase D8 acceptance validation — duplicate PAIR of each other; one should be closed as dup of the other, verify which.
- #14076/#14103/#14120 Exec Panel Phase 2 trio — #14076 dup of done #14075?; #14103 urgent "remove CHOOSE DEVICE strip" → done via #14102/#14132 (memory confirms); #14120 collapsible CURRENT TEST DEVICE card → #14132 REMOVED that card, so #14120 is likely OBSOLETE (card no longer exists) — verify then close.

## Notes
- Tester: nav #nav-bulk-runs pointer-intercepted by #perf-panel overlay (pre-existing, out of scope).
- Working tree still uncommitted (M1–M7, #13778, #13782) — commit-split advised before publish.
