# Exec layout · Workspace reorder (ticket #14068)

## Goal
Center execution workspace vertical order becomes:
Run Header → Choose Device → Browser/Device Preview → sticky tab bar
(Activity/Plan/Findings/Bugs/Report) → active tab content → quick
actions/composer. Tabs are never a page footer and stay reachable without
page scrolling at all six desktop resolutions.

## Approach (decided)
The browser preview (`.stage` + browser chrome + LDV header) moves from the
right `.viewer` aside INTO the center `.chat` panel, between the question slot
and the tab bar. The right panel remains the Live Device View column
(header device/OS/browser badges + environment card + compact stage mirror
not needed — it keeps its own preview surface). To avoid a SECOND preview
surface, the stage itself (single DOM node `#stage`) is relocated to the
center panel; the right viewer keeps the LIVE DEVICE VIEW header card and
gains the exec/log area (TARGET/EXECUTION/RUNTIME blocks that today live in
the viewer) sized to the remaining height.

DOM order inside `main.panel.chat` after the change:
head | run-summary | transcript | thinking | question | preview(stage) |
tabs | tab-body | quick-actions | composer  (10 grid rows)

Preview height: grid row `minmax(150px, 32%)` — shrinks at short
viewports, tabs + tab-body rows remain `auto`/`minmax(140px, 1fr)`.

The right `.viewer` becomes: LIVE DEVICE VIEW header + env card + exec log
(target/execution/runtime) — no second `#stage`. (Exec/log blocks for the
viewer are handled in #14069 / follow-up; this ticket only removes the
duplicate preview.)

## Files
- public/index.html — move `#stage` (chrome, stage-inner, overlays, empty
  state) from `.viewer` into `.chat` between `#question-slot` and `#tabs`.
- public/styles.css — `.chat` grid-template-rows gains a preview row;
  `.viewer` grid simplifies; stacking fixes for overlays inside chat context;
  responsive breakpoints (≤1280 slim, ≤1023 stacked) updated to keep order.
- public/app.js — no state changes expected; verify refs by id only.
- scripts/test-ui-responsive.mjs — new order assertion: tabs element top >
  stage element top in center column; tab bar reachable (top < innerHeight)
  at all six resolutions with long content.
- server/finalUiPolish.test.js / founderUi.test.js — update any grid-row
  regex that pins the old 9-row .chat template.

## Acceptance criteria
- [ ] DOM/visual order in center: Run header → (Choose Device ticket #14069
      inserts here) → preview → tab bar → tab content at all 6 resolutions.
- [ ] Tabs are not a page footer; no page-level scroll to reach them.
- [ ] Long activity content: tab bar + quick actions stay visible; only the
      tab pane scrolls.
- [ ] Preview shrinks at 768px-height viewports instead of pushing tabs off.
- [ ] Regression: tab switching, session switching, SSE frame updates,
      overlays/cursor still work; responsive + acceptance suites pass.

## Tests
- scripts/test-ui-responsive.mjs updated + green at 6 resolutions.
- scripts/test-acceptance.mjs T1/T6 updated for new positions; green.
- npm test + node --test public/*.test.js green.
