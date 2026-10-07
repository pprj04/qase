# 1024px dead-zone layout regressions (post-#14211 publish, fixed on NIHARIKA)

After publishing 90f3d45 to DEV, test:ui failed at 1024x768 only: 646px horizontal overflow + 34px page scroll. All six resolutions now PASS with two scoped CSS fixes (uncommitted at time of writing).

## Root cause
The responsive system flips to fixed-bottom feature-dock + 2-column stacked grid at `max-width: 1023px`. But TWO older `@media (max-width: 1100px)` blocks applied that fixed-dock/stacked-geometry at 1024px too, where the dock is actually in-flow in its 52px rail:

1. styles.css ~line 8849 block: `.feature-dock { right:50%; width:min(486px,...); transform:translateX(50%) }` → dock extended to x=1670, overflowing by 646px. Fixed by changing that block's condition to `max-width: 1023px`.
2. styles.css ~line 6868 block: `.runs { top: 38px; height: calc(100dvh - 42px) }` — `top` on a `position: relative` `.panel` is a render offset → 726px sidebar + 38px pushed bottom to 802px → 34px page scroll. Same condition change to 1023px.

## Diagnostic technique (reusable)
CSSOM walk over `document.styleSheets`, collecting rules matching the element IN DOCUMENT ORDER with their enclosing media condition — shows exactly which (mq, selector, order) wins and which stale block still matches. A plain getComputedStyle trace can't tell you source order.

## Other notes
- Cache: styles.css must be loaded via `styles.css?v=…`; bumped index.html to `?v=20261001-3`. Unversioned loads gave false FAILs.
- Login throttle (429) is in-memory; `procmgr restart service-bg-service-4182` clears it. It also intermittently eats the auth gate in probes — restart before diagnosing "login didn't happen".
- Browser probes that `import 'playwright'` must run from /workspace (node resolves local node_modules); /tmp fails with ERR_MODULE_NOT_FOUND.
- Playwright scripts run under run_bash can hit the 120s wall on login+settle; use a terminal session.
- Remaining benign "overflow" at 1024px: one `.tab` button inside the horizontally-scrollable `#tabs` bar (`overflow-x:auto`) — clipped, not page overflow.
- Post-fix verification: npm test 1058/0/20 skipped, public 107/107, test:ui PASS all six resolutions, test:acceptance PASS (incl. T16–T18).