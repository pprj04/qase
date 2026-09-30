# Center panel layout: token summary + run progress as separated regions

Reference layout (user-provided) for the QASE center agent panel:

```
┌─────────────────────────────────────────────┐
│ ~/qase/agent.log                            │
│ meeting.drytis.dev                          │
├─────────────────────────────────────────────┤
│ TOKEN row: ✦ 4.76M in · 27.2k out · 4.79M total   [LIVE] │
├─────────────────────────────────────────────┤
│ ● RUNNING   13/16   81%            Findings 12 │
│ ████████████████████░░░░░░                       │
│ Current activity  ◌ Validating microphone...     │
├─────────────────────────────────────────────┤
│ agent log (scrollable, fills remaining space)   │
├─────────────────────────────────────────────┤
│ > input bar (fixed at bottom)                   │
└─────────────────────────────────────────────┘
```

## Root cause of the overlap (diagnosed, not guessed)

- `.chat` is `display: grid` with a **fixed first row** (`64px` in cli-theme,
  `styles.css:4625–4628`) and the header's top padding is consumed by the
  absolutely-positioned `data-path` `::before` label (`styles.css:4402–4413`).
- `.head-actions` is `flex: 0 0 auto` capped at `max-width: 46%`
  (`styles.css:6970–6990`), **no flex-wrap**; `#usage-chip` has
  `white-space: nowrap`, **no max-width / overflow / ellipsis**, and its text
  grows in three segments as the run accumulates tokens + ctx %. The nowrap
  cluster overflows the cap and collides with `.chat-id`'s title/target.
- There is **no progress bar, step count, findings count, or current-activity
  row in the center panel today** — they live in the right viewer tabs
  (`#count-plan` index.html:173, `#count-findings` index.html:174) and in the
  thinking strip. The reference layout requires a NEW run-summary region; it is
  not only a spacing fix.
- `.usage-chip` has no `.cli-theme` override — a blue 10.5px pill inside a
  header otherwise styled 9px/terminal-green, which reads as an invading
  element.

## Structural changes (all in `public/index.html`, `public/styles.css`, `public/app.js`, `public/uiPrimitives.js`)

### 1. Center panel grid

`.chat` grid rows become (both base and cli-theme):

```css
grid-template-rows: auto auto minmax(0, 1fr) auto auto auto;
/* head, run-summary, transcript, thinking-strip, question-slot, composer */
```

- Header row `auto` (drop the fixed 64px row); keep the `data-path ::before`
  label with reserved top padding so it never collides with title content.
- Transcript keeps `min-height: 0; overflow-y: auto` (already correct) — long
  logs must never push the summary sections out of view.
- Composer remains the last `auto` row — always at the bottom.
- ⚠️ Preserve the ≤720px media-query rules `.cli-theme .chat { grid-row: 3 }`
  and `.cli-theme .viewer { grid-row: 4 }` — `server/finalUiPolish.test.js`
  asserts them.

### 2. New run-summary region (between header and transcript)

```html
<section class="run-summary" id="run-summary" hidden>
  <div class="token-summary" id="token-summary">
    <span class="token-glyph" aria-hidden="true">✦</span>
    <span class="token-text" id="token-text"></span>
    <span class="live-pill" id="live-pill" hidden>LIVE</span>
  </div>
  <div class="progress-card" id="progress-card">
    <div class="progress-top">
      <span class="status-chip" id="status-chip" data-status="idle" role="status" aria-live="polite">idle</span>
      <span class="progress-steps" id="progress-steps"></span>   <!-- 13/16 -->
      <span class="progress-pct" id="progress-pct"></span>       <!-- 81% -->
      <span class="progress-findings" id="progress-findings"></span> <!-- Findings 12, right-aligned, wraps below when narrow -->
      <button id="stop-run" ... hidden>Stop</button>
    </div>
    <div class="progress-bar" id="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
    <div class="current-activity" id="current-activity"><span class="ca-label">Current activity</span><span class="ca-state" id="current-activity-state"></span></div>
  </div>
</section>
```

- `#usage-chip`, `#status-chip`, `#stop-run` MOVE here from
  `header .head-actions` (keep their ids — no duplicate components). The
  header keeps only `#chat-title` / `#chat-target`. `.head-actions` may be
  deleted if empty.
- Token row: fixed height clamp(42px, 3.2vh, 52px), full width, horizontal
  padding matching the transcript, content vertically centered,
  `font-variant-numeric: tabular-nums`, LIVE pill pinned right
  (`margin-left: auto`), shown while `status === 'running'`. Height must not
  change as values update.
- Progress bar: own row, `i` fill width = percent, height ~6px, rounded,
  accent fill on `--border-strong` track. Never overlaps text (block row).
- Current activity: normal document flow below the bar. Text sources: while
  running — the same source as `thinking-peek` (current action, app.js
  `updateThinkingStrip`); on `done` — `✓ Run completed`; otherwise
  `◌`/hidden as appropriate. The thinking strip (collapsible reasoning)
  stays where it is — below the transcript — unchanged.
- Steps/percent: `session.todos` completed/total (`renderTodos()` already
  computes `done/total`, app.js:941–944 — reuse the same computation, render
  into the new elements). Percent = `Math.round(done/total*100)`, shown only
  when total > 0. RUNNING→DONE keeps identical layout (same rows, bar full).
- Findings: `session.findings.length` rendered as `Findings N`; hidden when
  the right-tab count is also hidden (0) to avoid an empty dangling label.

### 3. Token text composition

New `tokenSummaryText(usage)` in `uiPrimitives.js` (exported, unit-tested,
next to the existing `usageChipText`):
`[~]4.76M in · 27.2k out · 4.79M total` — reuses `formatTokens`; `~` prefix
per segment when estimated; total segment only when total > 0 and derivable.
Context % moves to the tooltip (title) so the row stays compact at all
widths. `usageChipText` and `#usage-chip` are superseded by this row for the
center panel (remove the chip element; keep the pending state as
`-- in · -- out` text in the token row with the same dimmed styling).

### 4. cli-theme styling

- Add `.cli-theme` overrides so the token row / status chip / progress bar /
  LIVE pill match the terminal green language (`#67e8a6`,
  `rgba(103,232,166,…)`) and the 9px/3px-radius chip conventions — fixing the
  long-standing blue `usage-chip` mismatch.
- Thin borders (`#192530` like the header), subtle panel backgrounds
  (`#0a1017` family), compact spacing, existing rounded corners.

### 5. Left session card (sidebar run row)

- Add `todoCompleted` / `todoTotal` to `store.listSessions` summary map
  (server/store.js:207–223) AND the Postgres list-summary path
  (server/postgres/runRepository.js) so rows stay consistent — additive
  read-only fields, no run-progress logic change.
- `renderRun()` (app.js:211–291): add a slim progress bar + `13/16` next to
  the dot when `todoTotal > 0`, and the token badge `4.79M tok` on the meta
  row. Fix horizontal squeeze: `.run-meta` children get
  `flex-shrink` clamps + ellipsis (timestamp and badges), so the token badge
  and device pill can never collide with the findings badge or each other.
  Keep the card compact (existing 54px min-height in cli-theme).

### 6. Responsive

- `.progress-top` uses `display: flex; flex-wrap: wrap;` with findings
  `margin-left: auto` — below ~1100px the findings block wraps under the
  steps rather than overlapping.
- Token row text stays readable: at narrow widths drop the `total` segment
  via a media query (or ellipsize the middle) — never overlap, never hide
  in/out.
- Verify 1280 / 1440 / 1600 / 1920 and smaller laptop widths.
- No absolute positioning, no negative margins, no arbitrary offsets for
  any of these sections (the existing `data-path` `::before` label may stay
  absolute — it is decoration, not one of the competing sections, but its
  padding band must be reserved).

## Constraints (from the user)

- Do NOT redesign the app; preserve colors, typography, navigation,
  behavior, and all functionality. No backend token-calculation or
  run-progress logic changes. No duplicate token/progress components.
- Existing structural tests to keep green: `server/finalUiPolish.test.js`
  (ids, media-query grid-row ordering, `Final workspace fit and finish`
  marker), `sqaUi.test.js`, `founderUi.test.js`, `modelSelectorUi.test.js`,
  `uiPrimitives.test.js` (update the "controller consumes extracted UI
  modules" regex list if new helpers are imported).

## Acceptance criteria (running app)

- [ ] Token row and progress card are visibly separate sections with clear
      8–12px vertical spacing; they never overlap at any tested width.
- [ ] A running run shows `● RUNNING`, `13/16`, `81%`, `Findings 12`, a
      progress bar at 81%, and a current-activity line in normal flow.
- [ ] A finished run shows `done ✓`, `16/16`, `100%`, full bar, and
      `✓ Run completed` — same layout, nothing shifts between states.
- [ ] LIVE pill sits at the right edge of the token row while running and
      disappears when done; token values update live without height or
      layout jumping.
- [ ] The agent log scrolls independently; a very long log never pushes the
      token/progress sections off-screen; input bar stays at the bottom.
- [ ] Findings wraps below the steps row at narrow widths instead of
      overlapping; at no width does it collide with the bar or token text.
- [ ] Left session card shows progress bar + step count + token badge with
      no horizontal overlap between badges/timestamp.
- [ ] Console shows no errors; all existing behaviors (send, stop, question
      flow, thinking strip, tabs) work unchanged.
- [ ] Full node --test suite green.
