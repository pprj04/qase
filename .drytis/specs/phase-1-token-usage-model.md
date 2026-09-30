# Phase 1 · Token usage data model & persistence

## Goal
Add a `tokenUsage` field to the run (session) aggregate, persisted in BOTH run stores (local JSON and Postgres), following the existing `context_usage` precedent exactly.

## Background
- Canonical session shape: `server/store.js` `createSession()` (lines 132–192) — add `tokenUsage: undefined`.
- Postgres: `qa_runs` table (`server/postgres/migrations/002_run_domain.sql`). Add migration `013_token_usage.sql` with `ALTER TABLE qa_runs ADD COLUMN token_usage jsonb;`
- Mirror `context_usage` in `runRepository.js`: `hydrateRun()` (~374–405), `insertAggregate`, `save` parameter lists.
- Register event type `'usage'` in `EVENT_CHILD_GROUPS` (`runRepository.js:41–76`) so `commit(session, 'usage', {...})` persists. Decide: store as run-row jsonb like `context_usage` (preferred — it's a finalized aggregate, not append-only history).
- `server/postgresServices.js` `createSession` + `summary` mapper; local `store.js` `listSessions()` (199–221); `runRepository.js` `list()` (724–749) — add a token usage summary to the run-list payload in BOTH.

## Data shape
```js
session.tokenUsage = {
  inputTokens: number,       // prompt
  outputTokens: number,      // completion
  totalTokens: number,
  cachedInputTokens: number,
  estimated: boolean,        // true when derived from SDK estimate rather than provider-reported
  updatedAt: <iso>
}
```

## Acceptance criteria
- [ ] After a run completes, `GET /api/sessions/:id` returns a `tokenUsage` object with non-zero numbers (when the provider reports usage)
- [ ] `GET /api/sessions` (run list) includes token usage totals per run in both local and postgres modes
- [ ] Existing sessions without token data load unchanged (`tokenUsage` undefined/null, no errors)
- [ ] `runRepository.test.js` asserts `token_usage` persistence round-trip, mirroring the existing `context_usage` test (lines 631–713)
- [ ] `store.test.js` covers the local-store round-trip

## Edge cases
- Old rows with NULL `token_usage` hydrate to `undefined` — no default-zero (distinguish "not counted" from "0 tokens").
- Migration must be idempotent (`ADD COLUMN IF NOT EXISTS`).
