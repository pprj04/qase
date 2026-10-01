# Review: ticket #13998 — browser view auto-collapse (2026-09)

**RESULT: PASS** (all 7 spec requirements + tests + no-prod-change verified).

Key facts:
- Collapse feature predates ticket: introduced in 687aed9 (`QASE phases 3-12`), ancestor of ce74c3d. Ticket added only `server/stageCollapseUi.test.js` (7 static source assertions) + spec file — both untracked in git at review time; zero production-code changes by this ticket. ce74c3d..HEAD range contains only the prior Studio-alignment merge (bca7244), which renamed `.cli-theme .viewer.stage-collapsed` → `.viewer.stage-collapsed`.
- Logic (public/app.js ~1016-1051): `STAGE_COLLAPSE_STATUSES = {done, error, interrupted, idle}`; `renderStageCollapse` guards on `stageHasContent()` and per-session override Set `state.stageExpanded`; `syncStageCollapse` (called from `setStatus` line 920, which every applyStatus/SSE path hits) deletes the override only for running/awaiting_input. No path collapses during a running run (running not in the set).
- New-session edge case: override Set is keyed by session id; `selectSession` sets `state.sessionId` before re-render, and stale ids are simply never consulted — correct by construction. `stageHasContent` uses `state.session?.frame` so old session frames never leak into the new run's decisions.
- R4 (frame preserved): `<img id="frame">` is static in index.html; collapse path only toggles CSS class / textContent / aria — no src/innerHTML manipulation (test also asserts forbidden patterns).
- Test style WARN (cosmetic only): new test uses top-level `await readFile('public/app.js')` with cwd-relative paths; 20/21 existing static tests use `readFileSync(new URL(...))`. Fragile if run from other cwd but `npm test` always runs from repo root.
- Full suite: 765 tests, 0 fail, 20 pre-existing skips. keepalive flake documented in verify-suite-flaky-under-full-concurrency.md.
