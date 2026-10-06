# Ticket #14385 Phase T3 (theme coverage) — round-2 review

## Round-2 fixes verified
1. Cache-bust: PASS — `styles.css?v=20261002-1` in index.html AND live-served (curl).
2. Winning-cascade hexes (#263342/#1c2836/#1d2b3d/#0b1520/#2f4d63/#3a5470/#21313c/#dbe6f2): grep → 0 hits in styles.css. `.env-table-wrap` live-computes rgb(229,229,229) (= --border #e5e5e5) in light mode — round-1 live failure resolved.
3. Parity script 8 selectors — judged acceptable as spot proof (browser tester independently verified dialog geometry).
4. `scripts/theme-layout-debug.mjs` deleted.

## NEW REGRESSION introduced by fix 2 (round-2 FAIL)
The migration tokenized backgrounds but KEPT hardcoded light text colors that only made sense on the old dark surfaces. Diff-confirmed (`git diff HEAD` added lines):
- `.dd-tab.is-active { background:var(--surface-3); color:#fff }` (L9598 + winning L10611) → white on light `--surface-3: #f4f4f5` = **1.10:1, invisible**. LIVE-VERIFIED via Playwright probe: bg rgb(244,244,245), color rgb(255,255,255), text "All".
- `.dd-device:hover { color:#fff }` (L9604/L10617) on light `--surface-2: #fafafa` = 1.04:1.
- `.dp-chip.is-active { color: var(--surface-2); background: #7dd3fc }` (L~) → near-white text on light-blue chip = 1.6:1. Self-contradictory (surface token used as a text color).
The audit script reports 0 non-intentional offenders (417 hits, all `.btn-primary` inverted — intentional) because the device-drawer active tab isn't in its sampled set.

## Re-confirmed PASSes
- Raw-hex regression grep: all 10 ticket-named source hexes → only in removed diff lines (71 removals). Total hex census 904→660.
- Brace balance: 2294/2294, depth 0, no negative dip.
- `--font-ui` on base :root (with explanatory comment) — Geist both themes.
- Suite: 1123 tests / 1103 pass / 0 fail / 20 skipped (reproduced).
- Round-1 bug fixes intact: `.run.is-active .run-title`→var(--text) L5738, `.empty-state h2`→var(--text), `.env-summary`→var(--success) L10529.
- Intentional non-migrations untouched; scripts secret-free (BASE=localhost, cred.json runtime-read).

## Verdict round 2
FAIL (1): fix-2's token migration of dd-tab/dd-device/dp-chip introduced unreadable active/hover states in light mode (white-on-light). Correct fix direction: `color: var(--text)` for active tabs/chips, or keep a dark accent background token.

## Pre-existing (out of round-1/2 scope, noted)
- `.test-on-prompt { color:#fbbf24 }` amber on white (~1.7:1) and `.dcl-empty { color:#6d8095 }` — pre-existing, not in this ticket's diff hunks.
- styles.css has pre-existing duplicated rule families (env-table, dm-card, dd-*) from an old merge — earlier occurrence is dead code.
