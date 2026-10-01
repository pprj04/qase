# Review — ticket #14024 Phase 2 (API client, SSE, session store, run list)

Commit basis: ef0805d + 3d0f81d (committed) + uncommitted Phase 2 files (src/api/, src/state/, src/components/RunList.tsx, App.tsx, shell.css, server/reactApiState.test.js). NOTE: Phase 2 work is NOT committed yet.

**RESULT: PASS (8/8 acceptance items), 4 minor WARNs, 0 FAILs.**

- client.ts is a faithful port of legacy apiResponse/api/apiText (app.js 221–254), verified line-by-line. Only deviation: 401-reload gate uses module `signedIn` flag via `setSignedIn()` — not wired anywhere yet (Phase 3 hooks it up), so 401-reload is dormant until auth lands. Correct, not a bug.
- sse.ts: all 20 event types, revision guard, 250/1000ms resync, 5s ready-timeout. Minor deviation: filter accepts events with `sessionId === undefined` (legacy requires strict match) — more permissive, safe.
- sessionStore: elapsedSecondsOf is an exact port; skew correction from status timing serverNow; 1s tick; terminal status → refreshRuns; delete falls back to remaining[0] like legacy.
- npm test: 779 tests / **759 pass / 0 fail / 20 skipped** (task said 758; actual is 759 — task's expected count was off by one, not a regression; Phase 1 baseline was 754 + 5 new tests).
- typecheck (tsc --noEmit) and build:react both clean; deployed bundle hash matches build output.
- Preview /app-react/ → 200; browser test (tester) independently verified live data path.

WARNs (non-blocking):
1. Phase 2 files uncommitted — must be committed before cutover.
2. setSignedIn dormant (Phase 3 dependency, by design).
3. SSE filter accepts sessionId-less events (intentional-looking, differs from legacy strictness).
4. shell.css additions include a few raw px values (26px avatar, 2px 10px btn padding, 2 rgba shadows) outside the --sp-*/token system — token discipline slightly looser than Phase 1's shell.css.

Known/documented elsewhere: tester noted no SQA/Founder/engine pills visible on the 29 real runs — that's data-driven (pills hidden for mode=qa / engine=chromium / device=desktop), matches legacy default-hiding, not a defect.
