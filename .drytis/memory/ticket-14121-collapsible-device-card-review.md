# Ticket #14121 review — collapsible CURRENT TEST DEVICE card (branch NIHARIKA, uncommitted)

Reviewed full uncommitted tree (also carries #14102 strip removal + #14077 selection-view work).

## Verdict: PASS (all 8 review items)

Implementation: `#ldv-env-card` head → `<button id="ldv-card-toggle" aria-expanded aria-controls="ldv-env-card-body">` with kicker + compact badges (`ldv-card-exec`/`ldv-card-status`) + chevron; details in `#ldv-env-card-body`. Empty-state card `#ldv-env-card-empty` untouched (no button/aria). CSS `.ldv-env-card.is-collapsed` → body display:none, chevron rotate 180°, padding 7px 12px; `.ldv-env-card-head:focus-visible` outline present. Persistence key `qase.deviceCardCollapsed` (restore with `persist:false` on load, so default = expanded when unset).

## Key points
- Auto-expand-once logic: `syncDeviceCardCollapse('expand-once')` only expands when `wasCollapsed && !_lastActive` (i.e. on idle→active transition); `_lastActive` resets to false whenever a render occurs without an active run. Manual collapse during active run is respected. Only call site: renderEnvironmentCard. Correct, no fight/repeat loops.
- Badge duplication: both copies (`ldv-card-exec/-status` + `-full`) set from single `execText`/`liveText`/`execLevel` in renderEnvironmentCard (app.js ~780-797). Grep confirmed no other writers/readers of the ids; no stale copy.
- Button contains only spans (phrasing content) — valid HTML.
- Dead code: line 823 `const toggle = deviceCardToggle();` in syncDeviceCardCollapse is unused (build artifact says removed but still in file) — cosmetic only.
- `aria-hidden="false"` on `.ldv-env-head-badges` span is a no-op (harmless).
- Chevron glyph "⌄" + rotate(180deg) on collapse — ⌄ collapsed reading as "down" then rotating to "up" when collapsed is debatable; tester + acceptance T18 all PASS so left as WARN-level note, not a fail.

## Test results (all run)
- `node --test public/*.test.js` → 99/99 PASS
- `npm test` → fails are PRE-EXISTING FLAKES, not this change:
  - drytisTransport nonce flake (~1 in 8 runs) — documented in `drytis-transport-nonce-flake.md`; unmodified by this diff.
  - keepalive "isActive predicate" test — timer-based flake; passed 6/6 standalone, file untouched by diff.
  - 5 re-runs: 4 pass / 1 single flake. Changed files pass standalone.
- `npm run test:ui` → RESULT: PASS (all viewports, no console errors)
- `npm run test:acceptance` → RESULT: PASS (T18/T18b/T18c/T18d all PASS; T17b NOTE pre-existing)
- Browser verification by tester: 8/8 PASS (V1-V5).
