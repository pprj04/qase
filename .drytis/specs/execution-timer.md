# Phase: Test Execution Timer (server-authoritative timing, history, analytics)

Branch: MANOJ (same tree as LIVE at a8b271b).

## Grounding facts (from researcher)
- Stack: Express 5 (`server/app.js`), agent lifecycle in `server/agent.js` `runTurn()`, status writes via `server/store.js:setStatus()` + `server/postgres/runRepository.js`, Postgres (raw SQL, migrations in `server/postgres/migrations/`, loader `scripts/migrate.mjs`).
- `qa_runs` already has `started_at` / `completed_at timestamptz` columns (002_run_domain.sql) — never populated, never exposed via `hydrateRun()`.
- Statuses: idle, running, awaiting_input, done, error, interrupted. User stop maps to `idle`.
- SSE: `GET /api/sessions/:id/events`; client `public/app.js` `connect()`/`resync()`; snapshot `GET /api/sessions/:id` merges live state (app.js:433). Refresh recovery exists but no timing data exposed.
- No analytics/history endpoints. Run IDs are UUIDs. No numeric progress % exists — the UI must NOT invent one.
- Queue entity `qa_execution_jobs` already records its own `started_at`/`completed_at`.

## Design decisions
- Server is the single source of truth: `started_at` set when the run actually begins executing, `completed_at` on any terminal state (done/error/interrupted/user-stop). Frontend computes elapsed from server-provided `startedAt`/`endedAt` + `serverNow`, using `Date.now() - serverNow` skew correction; no frontend-started timers.
- Phase breakdown (queue / setup / execution / report) captured as explicit status-transition timestamps persisted on the run: `queued_at`, `setup_started_at`/`setup_ended_at`, `report_started_at`/`report_ended_at` (nullable; report phase = report generation step in the workflow). Derived `*_duration_seconds` columns are computed in Postgres or at read time.
- Terminal states for display: done → Completed, error/interrupted → Failed, user stop → Cancelled, running/awaiting_input → Running (timer continues while awaiting input, or shows Paused for awaiting_input), idle-before-start → Pending.
- All timing exposed through existing APIs (`GET /api/sessions`, `GET /api/sessions/:id`, SSE status events) — no duplicate execution APIs. New aggregate endpoints only for analytics/comparison.
- Duration formatting client-side: `HH:MM:SS`, human `12m 18s`. No estimated-remaining time (no accurate progress metric — do not invent one).

## Phases
1. Schema + repository timing persistence (migration 013, runRepository writes/reads).
2. Agent lifecycle instrumentation (set started/completed/phase timestamps, emit in status events).
3. API exposure + analytics endpoints (snapshot/session list enrichment, /api/sessions/:id/timing, /api/analytics/durations, /api/projects/:target/comparison).
4. Frontend live timer UI (header timer, run details panel, state variants, refresh recovery, multi-session list timers).
5. History + analytics UI (history section with duration columns, performance panel, per-target trend comparison).
6. QA verification of timer scenarios (refresh, fail, cancel, concurrent, repeat runs) + regression check.
