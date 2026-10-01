# Ticket #14068 review (Exec layout · stage into center panel) — branch NIHARIKA

Reviewed 2026 session. Verdict: PASS with 2 WARNs.

- `#stage` moved intact from `.viewer` aside into center `.chat` (index.html:194-239), between `#question-slot` and `#tabs`; all element ids unchanged, app.js refs by id still resolve (el.stage/frame/cursor/targetBox etc. at app.js:94-101).
- styles.css:637 `.chat` is 10-row grid with `minmax(150px, 32%)` preview at row 6 + border-top; row pins 643-652. `.viewer` simplified to 2-row `auto minmax(0,1fr)` (styles.css:1637). `.cli-theme .viewer` at 6172-6174 is 2-row. Stacked breakpoints `.cli-theme .chat` at 6169 includes stage row.
- Known spec deltas (WARN, intentional per task scope): spec says preview row `minmax(160px, 0.34fr)` but impl uses `minmax(150px, 32%)` (matches ticket description). Spec's "viewer gains TARGET/EXECUTION/RUNTIME exec log blocks" not in this change — right panel is header + device card only; that half is split to sibling ticket (#14069 covers Choose Device; exec/log blocks presumably elsewhere).
- Legacy `.viewer`-scoped stage CSS fully removed (grep viewer.*stage = 0 hits). .app-level grid-rows at ~2963/6120/7880 are panel stacking only, don't reference stage.
- Tests: npm test 826/0/9; node --test public/*.test.js 95/95; test-ui-responsive PASS 6 resolutions (exec-order + tabs-reachable permanent assertions at scripts/test-ui-responsive.mjs:97-100); test-acceptance 15/15 T1-T15. Both UI suites need QASE_TEST_PASSWORD env from .drytis/cred.json (refuse to run otherwise).
- Browser verify (tester member) confirmed exact top-coordinate order at 1440×900, clean right panel, 332 activity rows at 1024×768 with zero page scroll, tab/session switching, console clean post-login (pre-login 401s are pre-existing, unrelated).
- Security: pure relocation, no new innerHTML/dynamic content.
