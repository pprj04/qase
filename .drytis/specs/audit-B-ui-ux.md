# Audit B — QASE UI/UX review + known-discrepancy re-check

## Goal
A ranked, evidence-backed list of UI/UX improvements for the QASE SPA (public/, vanilla-JS hash router), plus current status of the known dashboard data discrepancies from the 2026-09-01 audit.

## Scope — every route walked
- `#/runs` (sessions/missions list) — note sessions store legitimately empty (wiped by the test-isolation incident; document what the empty state looks like)
- `#/tests` (test cases) — 854 cases, filters
- `#/workflows` — extracted workflows
- `#/schedules` — schedules + regression runs
- `#/bugs` (findings) — filters, severity, evidence drill-down, pagination
- Overview dashboard — all cards

## Checks per route
1. Empty/loading/error states — trigger each where possible (bad mission id, offline API, empty store)
2. Data correctness vs API (re-verify the 2026-09-01 audit rows: 7,637 vs 7,617 mixed dedup on one screen; "100 regression runs" limit artifact (true 200); knowledge-updates label ambiguity (423 fix-validation flags vs 416 store entries); Authentication card 490/432/88% classifier drift)
3. Interaction basics — navigation, refresh persistence, back/forward, deep-link of a detail view
4. Visual consistency — typography/spacing/color reuse, broken images, overflow at 1280 and 375 widths
5. Basic a11y — heading structure, alt text, focus visibility, contrast spot-check, keyboard reachability of primary actions
6. Performance feel — route switch latency, large-list rendering (bugs list w/ 7,637 findings paginated?)

## Deliverables
- Ranked improvement list (P0 misleads-user → P3 polish), each with: what, where (route/selector), evidence (screenshot), suggested fix direction
- Verdict per known discrepancy: FIXED / STILL PRESENT / WORSENED

## Acceptance criteria (observable)
- [ ] Every route screenshotted at desktop + mobile widths, files under artifacts/audit/ (naming: route-width.png)
- [ ] Ranked list with ≥1 P0/P1/P2 example each (or explicit "none found at that tier")
- [ ] Each known discrepancy has current status + fresh evidence

## Out of scope
Implementing any UI change. Production code untouched.
