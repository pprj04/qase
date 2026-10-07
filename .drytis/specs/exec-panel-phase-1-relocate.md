# Exec Panel Phase 1 · Move preview + Choose Device + tabs into the right execution panel

## Goal
Reverse the #14068/#14069 placement: the RIGHT `aside.panel.viewer` becomes the ONE
execution panel with the exact vertical structure:

```
viewer (right execution panel)
  ├── panel-head   (Browser/URL header: LIVE DEVICE VIEW title, urlbar, device line)
  ├── #choose-device (collapsible)
  ├── #stage          (live browser preview, flexible height)
  ├── #tabs           (Activity │ Plan │ Findings │ Bugs │ Report)
  └── .tab-body       (active tab content, scrollable)
```

The CENTER `main.panel.chat` returns to: panel-head → run-summary → transcript →
thinking-strip → question-slot → quick-actions → composer (7 rows). Tabs are NOT a
page footer; they live in the right panel directly under the preview.

## Files to change
- `public/index.html`: move `#choose-device`, `#stage`, `#tabs`, `.tab-body` blocks
  from `main.panel.chat` (currently lines 199–294) into `aside.panel.viewer`, after
  its `.panel-head`. Keep all ids/element order intact (JS is id-based — verified
  no `.chat`-containment selectors exist).
- `public/styles.css`:
  - `.viewer` grid-template-rows: `auto auto minmax(120px, 1.2fr) auto minmax(0, 1fr)`
    (head | choose-device | stage | tabs | tab-body) with grid-row pins 1–5; tab-body
    is the scroll owner (min-height:0, overflow:auto).
  - `.chat` back to 7 rows `auto auto minmax(0,1fr) auto auto auto auto`; remove
    `.chat > .choose-device/.stage/.tabs/.tab-body` pins.
  - Update `.cli-theme .chat` (11 rows → 7), `.cli-theme .viewer`, stacked ≤720/≤520
    variants: stacked keeps the same viewer order; center gets the transcript flex.
  - `#stage` row uses flexible sizing — preview shrinks at small viewport heights,
    never pushes tabs below the viewport.
- `scripts/test-ui-responsive.mjs`: exec-order check flips — `#stage`, `#tabs`,
  `.tab-body` must be inside `.panel.viewer` (right panel), vertical order preserved,
  tabs reachable at all 6 resolutions.
- `scripts/test-acceptance.mjs`: T1 containment-free (keep); T2–T5 tab panes must
  render inside the viewer; T16 order (choose-device < stage < tabs) still holds.

## Acceptance criteria (true in the running app)
- [ ] Right panel shows, top→bottom: browser/URL header, Choose Device, live preview,
      tab bar, active tab content — all inside the viewport with no page scroll at all
      six resolutions (1920×1080, 1600×900, 1440×900, 1366×768, 1280×800, 1024×768).
- [ ] Center column contains run details, agent output/activity transcript, and the
      command input — no preview, no tabs.
- [ ] Tab content scrolls independently; the preview does not scroll with it.
- [ ] At 1024×768 the preview is smaller but visible; tabs + tab content reachable.

## Tests
- `npm run test:ui` (updated) PASS at 6 resolutions.
- `npm run test:acceptance` PASS.
- `npm test`, `node --test public/*.test.js` green (update founderUi/finalUiPolish
  regexes if they pin old grid strings).

## Edge cases
- Stacked ≤1023: viewer rows must still resolve (auto-sized stacked sections).
- `.cli-theme` variants missing pins → keep explicit row templates everywhere
  (known gotcha: implicit tracks lose sizing intent — see memory ticket-14069).
- Old cached CSS: bump `styles.css?v=` cache-bust query in index.html.
