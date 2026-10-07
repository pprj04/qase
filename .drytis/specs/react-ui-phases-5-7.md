# Phase specs 5–7 — React UI rebuild (cutover, remaining surfaces, cleanup)

Master plan: react-ui-redesign.md.

## Phase 5 · QA launcher + browser viewer + cutover

Goal: full QA run experience in React; React becomes the served UI.

- QA launcher dialog: target URL + demo-fill, device + landscape, engine checkboxes
  (synced from /api/engines with unavailable reason tooltips), scope checkboxes with
  select-all, test catalog from /api/qa/catalog (Standard + Security categories,
  per-category toggles, select/deselect all, count), security gate (authorization
  checkbox with custom validity + scope notes, gate visible only when a security
  test is selected) — port qaUiSelection/securityGateUi/securitySelectionUi behavior
  exactly. Per-engine run fan-out on submit (same payload fields: device,
  deviceLandscape, engine, selectedTests, securityAuthorization).
- Browser viewer: URL bar + browser dot/title, stage with frame image + cursor
  overlay (target box, animated cursor + ripple + label), stage-empty art.
  Auto-collapse on completion (terminal statuses), manual Expand/Collapse button
  (aria-expanded), per-session override respected, restore on new run, "Run complete
  — live view collapsed" note — port stageCollapseUi behavior exactly.
- Tabs: Activity (timestamped timeline), Plan (+count, todos), Findings (+count,
  severity styling, bug-status PATCH affordances), Report (verdict banner, severity
  grid, summary/covered/not-covered/recommendations, follow-ups, report actions:
  download md/pdf, copy, fix prompts, feedback modal w/ star radiogroup + edit,
  feedback summary section).
- Deep links `?run=<uuid>`; ⌘N shortcut for new run.
- **Cutover**: React build output becomes `public/` (vite outDir, index.html
  replaced). Legacy UI files kept on disk (unused) until Phase 7. All 21
  source-pinning tests still target legacy files → keep them passing by leaving
  legacy files in place; do not delete yet.
- Acceptance: complete QA run (launch → live browser → findings → report → feedback)
  in the React UI at the preview URL; stage collapse verified; deep link works;
  suite green.

## Phase 6 · Remaining surfaces + responsive

Goal: feature parity complete.

- SQA launcher (assurance profiles, product attributes, target fields, authorization)
  + SQA view tab; Founder launcher + Founder tab (founderView/founderPresentation
  reuse); completion report (showCompletedFounderReport equivalent).
- Bugs view: full-screen tracker with status/severity/run filters, search, table,
  scroll + live updates (bugsUi + #12780 behaviors).
- Admin feedback panel (stats, filters, workflow), performance panel (durations
  compare), Drytis board push (accept-all, push) — reuse drytisBoard logic.
- Responsive pass: dock → bottom bar ≤1100px, rail widths, stage sizing, mobile
  composer; keyboard/roving tabindex on tabs; reduced-motion variants.
- Acceptance: every surface from the inventory exists and works; responsive at
  360px/768px/1280px/1920px; suite green.

## Phase 7 · Cleanup, test rework, polish, ship

Goal: one codebase, verified, deployed.

- Remove legacy files (app.js, entry.js, entry-motion.js, styles.css, bugsView.css,
  entry-terminal.css and now-unused siblings) from public/ AND their imports.
- Rework the 21 source-pinning tests to assert equivalent contracts on the React
  source/build output (same behavioral guarantees: single status chip, security gate
  sequencing, stage collapse semantics, engine pill, no datalist, RUN_ID_PATTERN,
  showCompletedFounderReport-equivalent, uiPrimitives import contract, etc.). Pure
  unit tests for ported client modules added in Phase 2 stay.
- Full a11y check (focus order, aria, contrast in both themes), perf sanity (bundle
  size, no waterfalls), visual QA both themes.
- Browser E2E of every journey: auth, QA run (live + completed + collapse + toggle),
  SQA, Founder, Bugs, feedback, settings, deep link, theme switch.
- Publish to DEV, deploy to production (follow prod-deploy-ritual.md), verify live.
- Acceptance: legacy gone; suite green; both themes verified; production serving the
  new UI; all journeys E2E-pass.
