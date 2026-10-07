# Ticket #14121 — Collapsible CURRENT TEST DEVICE card (DONE)

Branch NIHARIKA, uncommitted. User request 2026-10-01 (image_568a608b.png — the device card).

## What changed
- index.html: #ldv-env-card head → <button id="ldv-card-toggle"> (kicker + compact badges #ldv-card-exec/-status + chevron #ldv-card-chevron); full details in #ldv-env-card-body; badges duplicated as -full ids inside body. Empty-state card untouched (no toggle).
- styles.css: .ldv-env-card-head button reset, .ldv-env-head-badges, .ldv-env-chevron rotate 180°, .is-collapsed → body display:none + padding 7px 12px (collapsed ≈34px).
- app.js: renderEnvironmentCard writes both badge copies from single execText/liveText/execLevel; syncDeviceCardCollapse('expand-once') auto-expands ONLY on idle→active transition (function property _lastActive; manual collapse mid-run respected; re-arms when run goes idle); setDeviceCardCollapsed persists localStorage 'qase.deviceCardCollapsed'; wireDeviceCardCollapse IIFE restores state + click toggle.
- test-acceptance.mjs: T18/T18b/T18c/T18d (default expanded, collapse+aria+badges visible, reload persistence, keyboard Enter).

## Verification
Tester PASS 8/8 (toggle both directions click+Enter, persistence both states, empty card unchanged, no overlap at 1920/1024 — collapsed 34px, expanded 162-171px, no page scroll; console clean post-login). Reviewer PASS + 3 cosmetic WARNs — WARN1 dead local + WARN3 aria-hidden no-op FIXED; WARN2 chevron direction (collapsed=up) noted, defensible. Suites: public 99/99, npm test 830/0/9 (drytisTransport nonce flake + keepalive timer flake documented pre-existing), test:ui PASS, test:acceptance PASS.

Note: pre-login 401 console noise (API calls fire before auth) is pre-existing, unrelated.