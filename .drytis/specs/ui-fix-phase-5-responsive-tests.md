# UI Fix Phase 5 — Responsive matrix, accessibility & UI test suites (P1/P2)

Branch: NIHARIKA only, after Phases 1–4.

## Goal
Verify and harden the whole workspace at the six required resolutions, finalize responsive grid columns, accessibility pass, and land the automated test suites: UI tests at all six resolutions plus the 15 functional acceptance tests.

## Responsive matrix (must hold at 1920×1080, 1600×900, 1440×900, 1366×768, 1280×800, 1024×768)
- No panel disappears, no horizontal overflow, no clipped buttons/content, no overlapping sections, tab content visible with usable height, preview usable, center workspace usable.
- Grid: left ~15–20%, center ~48–55%, right ~28–32% via minmax (conceptually `minmax(220px,18%) minmax(520px,1fr) minmax(420px,30%)`); NIHARIKA's current `clamp(232px,15.5vw,272px) minmax(420px,0.9fr) minmax(520px,1.18fr)` gives center 0.9fr vs right 1.18fr — center must dominate; ratios must be adjusted so center ≥ right at all six widths, right ~28-32%.

## 15 functional acceptance tests (from the request)
T1 Start QA run: run header/execution/Activity content/device panel/preview all visible.
T2 Plan click → plan content occupies workspace immediately.
T3 Findings click → visible immediately.
T4 Bugs click → visible immediately.
T5 Report click → visible immediately.
T6 Long activity log → only activity pane scrolls, page doesn't grow.
T7 Select iPhone 17 Pro Max → device + compatible environment auto-resolve.
T8 Change browser → active environment changes everywhere it's shown.
T9 SQA opens → same picker + inherited active environment.
T10 Founder opens → same picker + inherited active environment.
T11 Test case create → Add Device opens same picker.
T12 Bulk run → Add Device opens same picker.
T13 Right panel Change → same picker opens.
T14 Switch previous run → entire workspace updates (header/activity/plan/findings/bugs/report/device/browser/runtime/evidence).
T15 Resize browser → no critical content disappears.

## Acceptance criteria (running app)
- [ ] UI test suite passes at all six resolutions with the visibility/no-overflow/no-clip assertions above.
- [ ] All 15 functional acceptance tests pass in the running app.
- [ ] Tab bar arrow-key navigation + active state; focus visible on all interactive elements; statuses carry text labels not only color.
- [ ] Center column ≥ right column share at all six widths; right 28–32%.
-/right panel min width floor respected; at 1024×768 all three columns still present.

## Tests
- The suites themselves ARE this phase's deliverable. Add `test:ui` and `test:acceptance` scripts; extend npm test to include public/ unit tests (currently server-only).
- Ensure CI: node --test server + public + new suites all green.

## Edge cases
- dvh vs vh on mobile-embedded browsers; scrollbar-gutter; long device names at 1024×768; session switch mid-stream; resize while a run is live.
