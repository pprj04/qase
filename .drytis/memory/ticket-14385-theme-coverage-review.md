# Review · #14385 Phase T3 — theme coverage migration (round 1)

Reviewer verdict: **FAIL (1) + 3 WARN**. No changes made.

## FAIL — cache-bust not bumped
`public/index.html` L11 still serves `styles.css?v=20261001-5` — the pre-T3 string from #14383 round 2 — despite ~178 raw-hex rules being migrated. Server serves new content (live hex count 726 vs HEAD 904), so preview looks correct, but cached browsers keep the old stylesheet. Fix: bump to `?v=20261001-6`.

## WARN 1 — incomplete migration in duplicated (cascade-winning) rule blocks
styles.css has pre-existing DUPLICATED rule families (both at HEAD and now). This ticket migrated the *earlier* occurrence but the LATER one (which wins the cascade) still carries raw dark hexes:
- `.env-table-wrap { border:#263342 }` L10510 — live-computed dark navy border in light mode (verified via Playwright probe)
- `.env-table td { border-bottom:#1c2836 }` L10513
- `.dd-tab.is-active { background:#1d2b3d; border:#3a5470 }` L10611
- `.dcl-chip { background:#0b1520; border:#2f4d63 }` L11088
- `.feedback-*` block L11694–11748 (`#263342`/`#27272a`/`#dbe6f2`)
- `#21313c` borders L3816/3841/6573/8100
The earlier migrated blocks are dead code. Automated audit missed these because the surfaces weren't walked / were hidden.

## WARN 2/3 — minor
- `theme-layout-parity.mjs` samples only 8 selectors (dashboard only, no dialogs).
- `scripts/theme-layout-debug.mjs` is an untracked dev leftover, hardcodes BASE.

## Verified PASS
- Round-1 browser-test bugs fixed & live: `.run.is-active .run-title`→var(--text), `.empty-state h2`→var(--text) (both sites), `.env-summary`→var(--success), light `--text-faint` #a1a1aa→#8a8a92.
- Grep for the 10 ticket-named source hexes (#141a24/#263243/#c7d5e5/#070c12/#03070a/#eef4fb/#8fa3b8/#9aa3b2/#eff8f4/#d8e5eb/#92e1ca): **zero occurrences** in styles.css.
- Hex census 904→726. Brace balance 2292/2292, depth 0, no dip.
- Dark token values unchanged; `--font-ui` moved to base :root (Times fallback bug fixed, Geist confirmed both themes).
- Intentional keeps honored: entry-motion greens, browserChrome brands, `.btn-primary` inverted design (auditor's remaining "dark-surface" hits are exactly these).
- Suite 1123/1103/0/20 reproduced. Audit scripts: BASE defaults localhost, cred.json read at runtime, no secrets.
- `.run-exec-level-badge` fully tokenized (success/accent-hover/text-muted + soft bgs).
- bugsView.css / entry-terminal.css: no diff vs HEAD, token-consuming, light-safe.
