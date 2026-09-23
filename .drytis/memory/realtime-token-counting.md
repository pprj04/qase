# Real-time token counting (tickets #12528–30, 2026-09-23)

## How it works now
- `server/usageCapture.js`: `createUsageLedger()` dedupes per RUN — call ids minted per object via WeakMap (`minted` map), so the same report object re-surfaced reuses its id and is dropped. `subtractUsage()` rolls committed estimates back out (clamped ≥ 0).
- `server/agent.js` `runTurn`: `record.usageLedger` + `record.committedEstimates` live on the runtime record (survives auto-continuation turns — a per-turn ledger re-counted replayed reports, that was the original double-count bug). Estimates commit LIVE (throttled 1s, `USAGE_COMMIT_THROTTLE_MS`), not only real reports — required because the custom provider (glm gateway) sends no in-stream usage; the chars/4 estimate line is the only per-call signal. When a real report arrives, ALL of the current turn's committed estimates are rolled back via `estimateDelta` before it applies (provider is consistent within a turn; ids don't correlate across harvest paths). `commitTurnUsage` now only sweeps stragglers.
- Frontend `public/app.js`: `renderHeader()` shows `-- in · -- out` pending chip (dashed, dimmed) while running with no usage; `formatTokens` tiers raw → k → M → B; `scheduleRunBadgeRefresh()` throttles sidebar refetch to 1/5s on `usage` events. CSS: `font-variant-numeric: tabular-nums`, `white-space: nowrap`.

## Test conventions that matter
- Tests yield `finish_qa_report` tool_result AND set `session.report = {ts, verdict, summary}` — otherwise the prose-only auto-continuation path (INCOMPLETE_RUN_CONTINUATIONS=2) re-enters runTurn and ends in 'error'.
- Abort mid-stream: use `record.controller.abort()` (runTurn installs it); setting `record.running = true` yourself blocks runTurn with "already running".
- Full suite has pre-existing flaky timing tests: `outbound client bounds…` (drytisTransport) and `isActive predicate…` — pass in isolation and in most runs; not related to tokens.

## Verified E2E (2026-09-23)
Live run via API: input climbed 26k→39k→53k→…→245,607 during 'running', froze exactly at 'done'. Fresh run starts with tokenUsage None. Auth: cookie `qase_token` + CSRF from `qase_csrf` cookie (no /api/csrf endpoint) sent as X-CSRF-Token.
