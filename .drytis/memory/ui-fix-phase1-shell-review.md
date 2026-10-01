# Review: ticket #13972 — UI Fix Phase 1 (viewport shell & center tab workspace), branch NIHARIKA

## Verdict: PASS — gap fixes verified in re-review; earlier WARNs 2 & 3 now resolved

Uncommitted diff on top of merge 611d41c (also contains the #13973 honesty fix, reviewed separately):
index.html (tab move + dedup + ?v=20260930-2), styles.css (chat 9-row grid, viewer 2-row, ≤1280 slim cols, 1023px breakpoints, chip clamp, .todo-chip + .report-export-bar), app.js (autoScrollState + toggle, #tabs-scoped detailTabs, todo-chip in renderTodos, export bar in renderReport), founderUi/finalUiPolish test regexes.

## Findings
- Tabs moved index.html:197-219 into main.panel.chat between #question-slot and #quick-actions; viewer aside now panel-head + .stage only. No orphaned `.viewer > .tabs` CSS (grep: none). 14 dialogs balanced, all ids unique, single </body>.
- detailTabs correctly scoped `#tabs .tab` (device-matrix dm-tabs excluded). `.tab-pane` global selector in activateDetailTab is safe — only #tabs has .tab-pane markup.
- SQA/Founder auto-switch intact (app.js:2459-2467 → activateDetailTab).
- scrollFeed gated by autoScrollState.activity; toggle wired with aria-pressed (browser-verified round 3).
- Breakpoints: 1100px → 1023px in all 5 places; slim ≤1280 floors 196/292-300/342-348 (+52 cli dock) ≈ 868 min < 1024.

## Gap-fix re-review (spec items 6 & 8 — both now implemented, PASS)
- renderTodos (app.js:1990-1994) appends .todo-chip span, textContent-mapped {completed:'Passed', in_progress:'Running', failed:'Failed', blocked:'Blocked'} ?? 'Queued' — XSS-safe (createElement/textContent), chip className uses raw todo.status (className only, no injection surface).
- .todo grid now 3 columns (24px auto minmax(0,1fr)); .todo.in_progress / .cli-theme .todo rules still target .todo/.todo-mark → intact. .todo-chip-pending relies on base border (fine — queued is deliberately neutral). FAILED/BLOCKED variants styled but untested in browser (no session had those states — tester note).
- renderReport export bar (app.js:2217-2235): button prepended only when report exists; SQA/founder return early before it (2202-2208). Blob JSON, a.download = `qase-report-${sessionId}.json` (DOM property only, no injection path), URL.revokeObjectURL immediately after click. CSP allows blob: in img-src only; download attribute not CSP-gated — download verified working in browser (tester: qase-report-<uuid>.json downloaded).
- viewport-1366.png artifact removed (confirmed absent).
- Tests: npm test 820/811 pass/9 skip/0 fail (nonce flake reproduced once, cleared on rerun — see drytis-transport-nonce-flake.md); node --test public/*.test.js 80/80.

## WARNs (not fixed)
1. All changes still uncommitted (6 files M on HEAD 611d41c).
2. feedAutoScrolls() ternary is STILL a no-op (both branches 'activity', app.js:1948-1950) — the claimed "fixed to single expression" cleanup did not actually happen. Harmless dead code; only feed is the activity feed.
3. Test coverage for chips/export bar: no unit test references todo-chip / report-export-bar / "Export report" — browser-verified only.
4. Failed/Blocked chip states unexercised in browser (no fixture session with those statuses).
