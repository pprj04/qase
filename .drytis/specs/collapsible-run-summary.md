# Collapsible Run Summary (ticket #12730)

## Goal
Make the center-panel run-summary section (token row + progress card) user-collapsible.
UI-only change — no token calculation, run-progress, findings, or backend logic changes.

## Layout contract (unchanged)
`.chat` grid rows: `auto auto minmax(0,1fr) auto auto auto` — the run-summary is row 2
(`flex: 0 0 auto` equivalent via grid auto) and the transcript (`#transcript`) already has
`min-height: 0; overflow-y: auto`, so it absorbs vertical space freed by collapsing.

## Structure changes

### public/index.html
Inside `#run-summary`:
1. Add a toggle button at the END of `.token-summary` (visually right-aligned via
   `margin-left: auto`): `<button id="run-summary-toggle" class="run-summary-toggle"
   aria-expanded="true" aria-controls="run-summary-detail" title="Collapse run summary">⌃</button>`.
   (Plain text chevron — no icon library exists in the project; matches the existing
   glyph usage ✦/⏱/◌.)
2. Wrap the existing progress-card div in `<div id="run-summary-detail"
   class="run-summary-detail">…</div>` (collapsed content: detailed progress card
   incl. bar + current activity).
3. Add a minimized mirror row BEFORE `.token-summary`:
   `<div id="run-summary-mini" class="run-summary-mini" hidden>
      <span class="mini-tokens" id="mini-tokens"></span>
      <span class="mini-status" id="mini-status"></span>
      <span class="mini-progress" id="mini-progress"></span>
      <span class="mini-findings" id="mini-findings"></span>
    </div>` — the toggle button is NOT duplicated here (it lives in the always-visible
   token row, which stays on screen in both states).

### public/styles.css
- `.run-summary-detail`: `display: flex; flex-direction: column;` — plus
  `.run-summary.is-collapsed .run-summary-detail { display: none; }`.
- `.run-summary.is-collapsed`: reduce padding + gap; hide `.token-summary`'s detail text
  via `.run-summary.is-collapsed .token-text { display: none; }` (minimized row shows the
  compact `✦ 6.39M tokens` instead) — actually simpler: keep `.token-summary` visible in
  both states, but in collapsed state hide `#token-text` and show the glyph; the mini row
  carries the compact values.
- `.run-summary-toggle`: small (24×24) ghost button, `margin-left: auto`, uses theme
  colors, `aria-expanded` reflects state. No absolute positioning.
- `.run-summary-mini`: single flex row, same monospace/tabular-nums as token-summary,
  height ~28px, gap 10px, wraps gracefully below 1100px (`flex-wrap: wrap`).
- Transition: subtle — `grid-template-rows` is not animatable cheaply; use a 160ms
  opacity+max-height fade on `.run-summary-detail` is NOT used (max-height tricks are
  pixel hacks per the "no pixel offsets" requirement). Instead: the detail block uses
  `display: none` toggle + a 160ms `opacity`/`translate` micro-fade on the mini row, and
  the transcript reflows instantly (grid row is `auto`). No layout jump: the toggle is
  only ever a state flip in normal flow.

### public/uiPrimitives.js — new pure helper
```js
export function miniSummaryText({ usage, status, progress, findings }) { … }
```
Returns `{ tokens, status, progress, findings }` segment strings:
- tokens: `✦ 6.39M tokens` (or `✦ -- tokens` when pending; `✦ ${est}${total} tokens`)
- status: `● RUNNING` (uppercase) / `● DONE` / `● waiting for you` / `● idle`
- progress: `13/16 · 81%` (omitted when no todos)
- findings: `Findings 12` (omitted when 0)
Unit-tested in server/uiPrimitives.test.js.

## Behavior — public/app.js
- `state.runSummaryCollapsed` (boolean), default `false`. Persisted via existing
  mechanism: `localStorage` (the project already uses it for device prefs + `qase.session`).
  Key: `qase.runSummaryCollapsed` = `'1'`/`'0'`. Read once at init, written on toggle.
- `setRunSummaryCollapsed(collapsed)` toggles `.is-collapsed` class, `hidden` on mini/detail,
  `aria-expanded` + title + chevron glyph (`⌃` expanded / `⌄` collapsed) on the toggle.
- `renderMiniSummary()` — called from `renderHeader()` and `renderProgressCard()` so all
  existing live-update paths (events: todos/finding/status/timing, activity events,
  thinking deltas) keep the minimized row fresh. No new data fetching, no recalculation —
  it reads the same `state.session` the expanded card reads.
- `setStatus()` — no change to collapse state (RUNNING→DONE must not auto-expand).
- Run switching (`selectSession` → `renderHeader`) does NOT reset the preference.
- Pending-usage state mirrors the expanded row: `✦ -- tokens · ● RUNNING · …`.

## Acceptance criteria
- [ ] Default expanded; toggle at top-right of the summary collapses it
- [ ] Minimized state = single compact row: `✦ 6.39M tokens · ● DONE · 5/5 · 100% · Findings 4` + visible `⌄` toggle
- [ ] Detailed breakdown, progress bar, and current activity hidden when minimized
- [ ] Toggle expands back to full layout with values preserved (no reload/recalc)
- [ ] Preference persists across run navigation within session (localStorage)
- [ ] Live updates visible while minimized (tokens/status/progress/findings)
- [ ] RUNNING→DONE keeps current collapsed state
- [ ] Agent log gains vertical space when minimized; no overlap with log or header at 1280–1920px
- [ ] No absolute positioning / negative margins / pixel offsets — flex/grid + display toggle only
- [ ] Full test suite green; new unit tests for mini summary text pass
