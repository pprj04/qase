Reviewed #14125 (branch NIHARIKA, uncommitted tree). Fix: `.dp-modal { width:min(720px,calc(100vw-28px)); max-width:720px }` + `.dp-modal .modal-inner { width:auto }` replacing the old `.dp-modal .modal-inner { width:min(720px,94vw) }`.

Findings (all PASS):
- Root cause confirmed: base `.modal` (line ~2513) = width min(600px,100vw-28px) + overflow:hidden; sizing only `.modal-inner` never widens the dialog. Matches the layout-gotchas.md invariant "size the dialog itself".
- `.dm-modal` is safe: dialog widened to min(960px,94vw) and inner is width:100%/max-width:none — never exceeds dialog.
- Other inner-width rules audited: `.test-cases-inner,.bulk-run-inner { max-width:860px }` is INERT (max-width only; actual width comes from `.cli-theme .modal-inner{width:100%}` of a 600px dialog) — dead rule, not a clipping bug, pre-existing. sqa/founder/qa/run-target inner classes have NO css rules at all. founder-modal (900px) and sqa-modal (920px) dialogs size the dialog itself — correct pattern.
- ≤1023px media `.cli-theme .modal { width:calc(100vw-10px) }` beats `.dp-modal` (specificity 0,2,0 vs 0,1,0) — dialog only widens further at narrow widths; no clipping.
- Tests: npm test 839 tests / 0 fail (9 skipped — pre-existing skips). node --test public/*.test.js 99/99 pass. One transient server-suite failure on an isolated re-run that passed on two subsequent runs — flake, not related.
- Note: the uncommitted styles.css diff (62+/188-) mixes other tickets' changes (#14102 quick-actions removal, #14074 exec panel grid) with this ~10-line fix.
- Tester's browser verification confirmed post-fix geometry (dialog 720px, content 16px/29px inset, no clipping at 1024/1280/1366/1920) and working search/select flow. Only failure was 5 pre-login 401 console errors on the landing page — pre-existing, unrelated.
