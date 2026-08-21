# BUILD 4 — FINAL DEMO POLISH / RELEASE CANDIDATE

Scope: presentation-layer polish only (public/). NO new backend capabilities,
NO engine changes, NO fake BrowserStack connectivity, NO fake test results.

## Areas to inspect as a first-time demo user
1. Dashboard (overview/empty + populated)
2. Navigation (topnav, routing, active states)
3. Runs (list + create)
4. Execution detail (tabs: REASONING_LOG / APPLICATION_ANALYSIS / EVIDENCE /
   FINDINGS / REPORT)
5. Evidence (screenshots, traces, artifacts, zero-states)
6. Findings (session findings tab + Bugs hub)
7. Bugs (board + detail)
8. Tests (cases, suites, replay)
9. Schedules (list + create)
10. Settings (modal, provider, BrowserStack)
11. BrowserStack section (truthful states: LOCAL vs BROWSERSTACK)
12. Mobile/device presentation (REAL_DEVICE vs EMULATED_DEVICE vs DESKTOP,
    viewport strip, device classify)

## Allowed fixes (demo-quality only)
- Broken alignment / overflow / clipped text
- Inconsistent spacing, radius tokens, duplicated UI
- Confusing/stale labels
- Missing loading states, missing error states
- Broken buttons, empty unexplained areas
- Inconsistent status badges
- Environment clarity: REAL DEVICE / EMULATED DEVICE / DESKTOP and
  BROWSERSTACK / LOCAL must be legible and consistent everywhere

## Forbidden
- New server capabilities, engine changes, fake BS connectivity, fabricated
  results, store schema changes.

## Defect log (fixed during Build 4 — all presentation-layer)
1. bugs.js ext4-corruption → recovered valid Build 3 source from Playwright
   HTTP cache (see notes/bugsjs-corruption-recovery.md)
2. Settings modal API-token label wrapper missing (index.html)
3. conn-label stuck "connecting…" with no session → "idle — no run selected"
4. RUN FAILED vs RUN INTERRUPTED badge split
5. Mobile nav (≤390px): right cluster unreachable → ⋯ overflow menu moving
   the live project-select (no duplicated IDs); phone block appended LAST in
   styles.css so it wins over the tablet block; scrollLeft snap-back on close
6. Boot/selectProject auto-created "New test run" shells → removed; empty
   hero instead; composer creates on first submit only
7. Evidence screenshots: honest banner (agent missions stream live, don't
   persist images; Tests-page runs DO persist screenshots/traces)
8. Deep links #/runs/<sessionId> now select the run; hash syncs on select
9. Findings: "⛓ evidence: 0" hidden when 0 (inline-evidence note instead);
   exact duplicate titles collapsed to ×N occurrences badge
10. Schedules: stale 0/0 bars → "—" + dim gray + legend entry + tooltip;
    relativeTime() future-aware ("in 17h" not "just now"); deleted 2 of 3
    duplicate "Auto:" schedules; purged 5 empty run shells from the list
11. BrowserStack settings: real last-test failure line (✗ failed: message)
    — connectivity never faked

## Acceptance criteria
- [x] All 12 areas inspected with concrete defect list
- [x] Every fixed defect verified in browser (before/after)
- [x] Status badges consistent (same status → same style app-wide)
- [x] Device/environment badges use one vocabulary
- [x] Loading + error + empty states on async surfaces
- [x] Regression suite green (existing tests) — 1104 tests, 1103 pass,
      1 known cross-suite race (C2) documented (notes/regression-suite-baseline.md)
- [x] Full demo journey Dashboard → create/start test → execution →
      reasoning → analysis → evidence → findings → report → bugs runs clean
      (two real agent runs: CRM 9901 + TaskBoard 9902; 4 initial FAILs
      fixed and re-verified 4/4 PASS by tester; journey stops 1-10 all PASS
      in final state — see release report)
- [x] Release-readiness report produced (.drytis/phase-19-final-report.md)
