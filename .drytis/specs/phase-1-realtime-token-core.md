# Phase 1 · Real-time per-call token accounting core

## Goal
Make token usage commit/emission happen per model call instead of only at turn end, with idempotent, call-id-keyed accumulation, so the `usage` SSE event fires during an active run.

## Background (current state)
- `server/usageCapture.js`: `attachUsageCapture()` intercepts real provider-reported usage per call (normalized `{inputTokens, outputTokens, totalTokens, cachedInputTokens}`); `applyUsage()` accumulates into `record.turnUsage.reports`; estimates (chars/4 fallback) never override real values.
- `server/agent.js`: `commitTurnUsage()` (lines ~631–649) folds reports into `session.tokenUsage` and emits `usage` — but is only invoked from `completeRun()` and terminal error/stop paths.
- Persistence: `qa_runs.token_usage` jsonb (Postgres, `runRepository.js` `save()` line ~845) and in-memory/file store `server/store.js`. Both stores have equivalent fields — REUSE them, do not add duplicate fields.
- No per-call record or call id exists today.

## Changes
1. **Call ids & ledger**: in `usageCapture.js`, generate a unique `call_id` per harvested report (timestamp+counter uuid is fine; use provider request id when available). Keep a per-run in-memory Set of processed `call_id`s; skip already-processed ids (idempotency). Extend the normalized shape to `{input_tokens, output_tokens, total_tokens, cached_input_tokens, call_id, model, last_updated_at}` (camelCase equivalents matching existing `tokenUsage` naming).
2. **Early commit in agent loop**: in `server/agent.js` stream loop, after each harvest of a real usage report, immediately fold that single report into `session.tokenUsage` and emit/persist via `commitTurnUsage` (or a light `commitUsageDelta`). Throttle persistence/emission to at most once per ~1s per run (coalesce deltas); always flush on turn end.
3. **No reset between turns**: ensure accumulation survives across agent turns within one run; verify nothing reinitializes `tokenUsage` mid-run.
4. **No double-count**: since per-call commit happens inside the loop AND `commitTurnUsage` runs at turn end, restructure so turn-end commit only flushes pending (uncommitted) deltas — never re-folds already-committed reports.
5. **Observability**: structured log per committed call: run_id, call_id, model, input/output/total tokens, ts. No prompt content.

## Files
- `server/usageCapture.js`, `server/agent.js`, `server/store.js`, `server/postgres/runRepository.js` (only if commit path needs a param), `server/postgresServices.js` (event publish path if needed).

## Acceptance criteria (running app)
- [ ] During an active run, the header token numbers increase as each model call completes — without page refresh or run completion.
- [ ] Counts accumulate across multiple model calls/turns (e.g. 10k+2k then 5k+1k → 15k in / 3k out displayed mid-run).
- [ ] Final persisted `token_usage` for the run equals sum over unique model calls; replaying a duplicate usage report does not change totals.
- [ ] Server logs show one structured token-accounting line per model call with run_id and call_id.

## Tests
- Unit: usageCapture idempotency (same call_id twice → counted once), delta coalescing/throttle, cross-turn accumulation.
- Integration: simulated multi-call run; DB `token_usage` matches expected sum at mid-run and end.
- Regression: existing `agent.js` / `runRepository.test.js` suites pass.
