# Device & Browser Matrix redesign — M1–M6 complete (2026-10-02)

Tickets #14420–#14425 all Done, reviewer PASS (M2/M3/M4/M5 needed round 2), tester PASS every round. Working tree UNCOMMITTED on NIHARIKA (with earlier #14275/#14383–86 work) — commit-split advised.

## What shipped
- **Catalog 2027.02.0**: channels per browser (positional channelForVersion — never hardcoded), Surface Pro 9/10/11, Laptop 5/6/7, Go 3, MacBook Air (M1), MBP 13 M1/M2, iMac 24 M1. 38,458 envs / 174 devices. Clamp 50k→80k (8 sites). All old envIds byte-identical.
- **Client model** public/deviceBrowserMatrix.js (pure): sidebar tree (6 categories, otherBucket→macos fallback), favorites/recents stores (qase.matrixFavorites / qase.recentEnvironments), buildBrowserColumns, assembleSelection (active-envs only), selectionDisplayString.
- **UI**: matrixSidebar.js (categories/OS chips/stars/expand-collapse) + matrixColumns.js (7 inline-SVG brand columns, channel labels, per-version stars, More windowing, WebKit notes) + top bar (URL + Refresh, canonical QA prefill applied AFTER form.reset in openQaStart) inside the SAME #device-picker dialog. Legacy card list retained. Add-mode honored via devicePicker.selectEnvironment → reselect.
- **browserChannels.js**: client mirror of server ladders; validate-matrix check 7b-client diffs them (npm run validate:matrix).
- **Responsive**: ≥1024 unchanged, tablet 232px sidebar + 44px targets, <720 Categories toggle (mx-sidebar-collapsed).

## Gotchas hit
- CSS source-order: base rule AFTER a media query at equal specificity silently kills it (mx-sidebar-toggle bug).
- openQaStart() calls form.reset() — prefill must go AFTER it.
- app.js renderSummary six-part format now includes availability.
- More-button pointer interception during dialog open animation (cosmetic, unfixed — noted M4/M6).
- matrixSidebar.js old `byCategory.other` crash → explicit otherBucket object.

## Open items
- Surface Go 4 absent (M1 ticket-scoped divergence, accepted).
- SQA/Founder write-through verified via shared renderAllTestOnBlocks path, not literally tested.
- Stale board tickets #13778, #13782–13785, #14076, #14103, #14120 suspected dups of done work (pre-matrix).
- #nav-test-cases pointer interception (pre-existing, unrelated).
