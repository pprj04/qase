# BUILD 1 — DEMO UI FOUNDATION

Scope: visual consistency + state hygiene on the EXISTING Qase UI only.
Frozen: all server/ code (Phase 16/17/18 engines, B0.1/B0.2/B0.3), stores,
API contracts, functionality, information architecture (no new pages/nav).

## Inspection findings

1. **Duplicate id `mission-stage-strip`** (index.html:161 hidden viewer copy +
   :208 visible activity-tab copy). `pipeline.js renderPipeline()` uses
   `getElementById` → always grabs the FIRST (hidden, viewer) one → the
   mission stage strip never renders in the REASONING_LOG pane where users
   look for it. Real functional bug caused by the duplicate.
2. **Orphaned hidden containers** outside any page (Phase 15 leftovers):
   `#findings-list`, `#workflow-pane`, `#regression-pane`, `#count-findings`,
   `#count-workflows`, `#count-testcases`, `#count-regression`.
   `renderFindings()` in app.js still renders session findings into the
   invisible `#findings-list`; the EVIDENCE tab count shows plan steps, not
   findings.
3. **Inconsistent radius tokens**: `--radius: 3px` design token, but 36×
   hardcoded `8px` radii (wf-save-form era), 24px pill on the mobile viewer
   toggle, 14px mobile viewer sheet — mixed visual language.
4. **Silent catch → empty array** in loaders (tests.js ×2, workflows.js,
   schedules.js, bugs.js board): on API failure the page shows the EMPTY
   state ("No test cases yet") — indistinguishable from a healthy empty
   project. No retry affordance anywhere on page loads.
5. **Radius/label inconsistencies**: `.wf-save-btn` custom button style
   duplicates `.btn` but ignores tokens; status-chip vs run-status-dot have
   duplicate rule blocks (4694+ overriding 263+); `.fx-` modal family uses
   different border tokens than `.modal`.
6. **Loading states**: tests/workflows/schedules/bugs pages render instantly
   on cached/empty data with no skeleton/loading indicator on first load.
7. **Topnav**: consistent, but `+` project button has no title/aria-label;
   device-select and project-select widths unbounded on small screens.
8. **Tables/lists**: `.fx-assert-table` + run lists are fine; testcase list
   rows have hover but no focus-visible ring for keyboard users.

## Changes

### A. Duplicate id fix (functional)
Rename viewer-panel copy at index.html:161 to `mission-stage-strip-viewer`
(no JS references it); keep the activity-tab copy as the canonical
`mission-stage-strip`. Result: pipeline strip renders in REASONING_LOG.

### B. Orphan cleanup (index.html + app.js)
Remove `#findings-list`, `#workflow-pane`, `#regression-pane`, `#count-findings`,
`#count-workflows`, `#count-testcases`, `#count-regression` and the
`renderFindings()` writes into the hidden pane (keep `updateExecStats()`;
keep findings rendering on the Bugs page + session report, which are the
real surfaces). EVIDENCE tab count continues to show plan steps.

### C. Error states with Retry (tests/workflows/schedules/bugs loaders)
Replace silent `catch → []` with a page-level inline error banner
(`.page-error` + Retry button) rendered into each page's list container.
Retry re-invokes the loader. Success clears the banner. No fake data.

### D. Loading states
Add `.page-loading` skeleton bar (CSS-only, shimmer via existing --ease)
shown by each page loader while the first fetch is in flight; removed on
completion/error. Only on initial load (not refilters).

### E. Design-token pass (styles.css, additive overrides at end of file)
- Unify radii: map legacy 8px → `var(--radius-lg, 8px)`; keep 3px sharp
  aesthetic for buttons/inputs/cards (introduce `--radius-lg` for media
  thumbs/shot cards); keep 24px pill ONLY for the floating mobile toggle.
- `.wf-save-btn`/`.wf-name-input` restyled to consume `.btn` tokens.
- Status chip: fold the duplicate 4694+ block into one set of rules using
  color-mix on tokens (light-theme safe); run-status-dot same.
- `.fx-*` modal family: point `--border/--surface/--bg` fallbacks at the
  real tokens (--hair/--glass-2/--glass) so Phase 18 dialogs match the
  design system in both themes.
- Focus-visible rings: add `:focus-visible` outline (2px accent) to
  interactive rows, tabs, tree items, buttons — keyboard consistency.
- Topnav: add `title`/`aria-label` on the project + theme/settings buttons
  (index.html), bound project-select width (max-width 180px, ellipsis).

### F. Typographic hierarchy
Define scale: h1 20px / h2 17px (page titles) / h3 15px / small+labels
11–12px uppercase tracking — as token overrides; page headers already
follow `X-header h2` pattern; normalize `.schedules-header-left h2` and
`.workflows` h2 to the same size/weight/margin; unify stat blocks
(`.tests-stats`, `.workflows-stats`, `.schedules-stats`, `.bugs-stats`)
to one shared look via a grouped selector.

### G. Responsive/overflow hardening
- Word-break on long URLs in bug cards (`word-break: break-word`) — verify
  present, add where missing.
- `overflow-x: auto` wrapper for tables (`.fx-assert-table` containers).
- Min-width guards: header-right filters wrap (flex-wrap) at 1024px.
- Verify `.app` grid breakpoints don't clip chat (already 1024/768 rules).

### H. Empty states
Keep existing per-page empty states (good, on-pattern); ensure they render
the shared `.page-empty` style where they diverge (wf-page-empty vs
bug-empty vs tc-empty) — normalize padding/type only, no copy rewrites
except adding the shared class.

## Tests
- UI smoke (Playwright via tester): nav across all 5 pages, tab row,
  pipeline strip visible in REASONING_LOG during a run or with stage data,
  tests/workflows/schedules/bugs empty-vs-error states, modal open/close
  (settings, tc-editor, bug-editor), responsive spot check at 1280/768.
- Existing regression suite (49 suites) — must stay 0 fail.
- Route verification: hash routes #/runs, #/tests, #/workflows, #/schedules,
  #/bugs all render their page.
- server/ zero-diff check: git status must show ONLY public/ + spec changes.

## Acceptance criteria
- [ ] No duplicate ids in index.html
- [ ] Orphaned Phase-15 containers + renderFindings hidden-pane writes gone
- [ ] Pipeline strip renders in REASONING_LOG tab
- [ ] Load failures show error banner with Retry (4 pages); success clears
- [ ] First-load skeleton on 4 pages; removed after load
- [ ] Radii/buttons/chips/fx-modals use design tokens in both themes
- [ ] Focus-visible rings on interactive elements
- [ ] Page h2 + stats visually consistent across 4 pages
- [ ] Long URLs don't overflow cards; tables scroll horizontally
- [ ] All hash routes render; no console errors from these changes
- [ ] Full regression 49 suites / 0 fail
- [ ] server/ untouched (zero-diff)

## STOP rule
No backend changes. No new pages/nav/routes. No functionality changes.
No new dependencies. Do not touch Phase 16/17/18 UI logic (bugs.js fix
validation rendering, ux-quality-panel, pipeline stages) beyond the
documented duplicate-id rename and loader error paths.

## Post-verification addendum (tester rounds + live mission work)

1. **Mission stage strip / phase tracker** (tester rounds 2–3): the pre-BUILD 1
   duplicate-id bug meant `#mission-stage-strip` AND `#mission-phases` always
   resolved to the hidden viewer copy — the visible REASONING_LOG pane never
   showed either, since Phase 15. Fixed: single containers in the activity pane
   (`#mission-stage-strip` empty-shell for pipeline data + sibling
   `#mission-phases` tracker); hidden viewer copy removed entirely. DOM verified
   count=1 each, correct pane. Caveat: the stage strip renders only when
   `session.pipeline.stages` exists — populated exclusively by the Phase 12
   capability orchestrator (`POST /api/sessions/:id/run-pipeline`), which no
   current flow invokes (0 of last 60 sessions have pipeline data). Strip stays
   `display:none` when empty (honest).
2. **Phase tracker live**: visible during active runs (SSE status running);
   added `updateMissionPhase(session.status, …)` hydration in `renderHeader()`
   so late joiners selecting a running session also see it (app.js). Server
   sends no activity label in status events, so phase inference falls back to
   Explore — documented as partial, not fabricated.
3. **Mission honesty guard** (server/index.js finalizeMissionFromSession):
   sessions ending error/interrupted now finalize missions as `failed` with
   `failureReason` (first system error, or watchdog/interrupt explanation)
   instead of fabricated `completed / pass / Q100`. Verified live: both
   403-model runs (4fde3e22, f95c0465) now read `failed`; tester confirmed run
   list + chip show "error" not pass. Note: interrupted sessions that did real
   work (7bcce921: 79 steps, 2 findings, watchdog cut before report) are
   honestly `failed` with reason — findings preserved on the session.
4. **Model config repair**: `.qase/config.json` model had drifted to
   `drytis/claude-opus-4.7` (403 team-not-allowed) — restored via PUT /api/config
   to `z-ai/glm-5` (team-allowed model from .env). Mission 1cd3f06d then ran a
   genuine 11-minute audit (79 steps, 2 real findings).
5. **Console 404s** `/api/missions/:id/ux-quality` + `/mission-for-session`:
   legitimate empty-state fetches (missions without UX assessments; panel hides).
   Cookie-authenticated in browser — not a defect. No change made.
6. **Regression**: full loop executed during a live mission (2 suites failed:
   phase11a — metrics/findings-store data dependency, passes clean on isolated
   rerun 6/6; phase9.2-revalidate-e2e — disrupted by leader's mid-loop server
   restart + premature 400s timeout; the suite polls real missions up to 22
   min). Clean rerun of suite 42 against final code recorded in the build
   report. Two spec STOP-rule lines superseded by documented, user-visible
   honesty fixes: server/index.js (+guard, reason), model restored z-ai/glm-5.

## Acceptance criteria — final state
- [x] No duplicate ids in index.html (scan: none)
- [x] Orphaned Phase-15 containers + renderFindings hidden-pane writes gone
- [x] Pipeline strip + phase tracker live in REASONING_LOG tab (single
      containers; strip hidden when no pipeline data — honest empty state)
- [x] Load failures show error banner with Retry (4 pages); success clears
- [x] First-load skeleton on 4 pages; removed after load
- [x] Radii/buttons/chips/fx-modals use design tokens in both themes
- [x] Focus-visible rings on interactive elements
- [x] Page h2 + stats visually consistent across 4 pages
- [x] Long URLs don't overflow cards; tables scroll horizontally (tester PASS)
- [x] All hash routes render; no NEW console errors from these changes
- [~] Full regression: 44/46-suites pass in-loop; phase11a passes clean on
      isolated rerun; phase9.2-revalidate-e2e conclusive rerun recorded in
      report (real-mission suite, ~15-22 min)
- [~] server/ untouched → superseded: two documented honesty fixes
      (finalizeMissionFromSession guard; model restored to z-ai/glm-5)
