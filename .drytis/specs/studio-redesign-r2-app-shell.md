# Studio Redesign R2 — App Shell (header, sidebar, run list surfaces)

Ticket: #13957. Builds on R1 tokens (#13956) and U1 typography (#13989).

## Goal

Re-skin the persistent shell to Drytis Studio patterns — white/zinc sidebar
surfaces, zinc borders, Studio radii and hover states — WITHOUT changing layout
structure, DOM ids, or JS behavior. R2 is presentation-only; the IA restructure
(moving buttons into a nav hierarchy) is U2 (#13990), NOT this ticket.

## Surfaces

1. **Runs sidebar (aside.panel.runs)** — Studio sidebar: `--panel-sidebar`
   (#fafafa light), white run rows with zinc borders, 10px radii, subtle hover
   (#f4f4f5), active run = white card + accent left edge. Brand header styled as
   Studio masthead. `data-path` breadcrumb kept but de-emphasized.
2. **panel-foot** — restyle as a Studio footer nav: slightly larger text (12px),
   ghost buttons with hover surfaces. KEEP the exact `grid-template-columns:
   auto minmax(0, 1fr) auto auto` and `.foot-btn { grid-column: auto }` rules —
   finalUiPolish.test.js pins them verbatim.
3. **workspace-chrome top bar** — Studio top bar: white bg, zinc bottom border,
   zinc traffic dots kept (macOS motif), 33px height kept (grid padding depends
   on it).
4. **Quick Actions strip** — Studio toolbar: white pill container, zinc-bordered
   chips with hover, sans font. (Its reorganization into nav is U2.)
5. **Run list rows** — sans font 13px titles, 12px meta, zinc hairlines,
   status chips with alpha tints (success/danger/warning at ~10% bg).
6. **perf-panel / feedback-panel** — Studio cards: white bg, 14px radius,
   zinc borders, shadow-panel.

## Constraints

- finalUiPolish.test.js pins: "Final workspace fit and finish" comment,
  .cli-theme .panel-foot grid-template-columns EXACT, .foot-btn grid-column
  EXACT, media-query blocks touching .feature-dock/.toasts/.chat/.viewer —
  do not delete or reorder those blocks; only restyle properties inside.
- founderUi.test.js pins `<nav class="feature-dock" ...>` literal and the dock's
  responsive column layout — dock restyle only inside those rules.
- founderUi.test.js pins "CREATED FOR DRYTIS" — keep the string wherever it lives.
- No id/class removals; no DOM edits in index.html (except none needed).

## Acceptance

- [ ] Sidebar/foot/top bar/quick actions/run rows render Studio light surfaces
- [ ] Dark scheme: all shell surfaces use the zinc dark tokens
- [ ] All pinned seam assertions pass unchanged
- [ ] npm run verify green
- [ ] Headless boot light+dark: zero page errors, interactive
