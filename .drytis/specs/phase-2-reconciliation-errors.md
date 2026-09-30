# Phase 2 · Run isolation, final reconciliation, error/interrupt handling

## Goal
Guarantee run-scoped counters, authoritative final value on completion, and preservation of known usage on failure/stop/refresh.

## Current state
- Run isolation: sessions carry `ownerUserId` (`store.js:getSession(id, ownerUserId)`), Postgres rows keyed `(organization_id, project_id)`; commit path enforces tenant scope. SSE endpoint `/api/sessions/:id/events` is session-scoped — isolation is mostly inherited; verify the usage commit path respects owner/tenant (it funnels through `runStore.commit`, so yes).
- Terminal paths: `completeRun()` → status `done`; stop → `idle`; pending question → `awaiting_input`; failure → `error` (agent.js ~792–856). Today all call `commitTurnUsage`, so usage survives — but the new per-call path must keep that guarantee.

## Changes
1. **Run isolation**: assert the per-call commit uses the same session/owner scoping as `runStore.commit`. Starting a new run creates a session with `tokenUsage` undefined → new counter; add explicit test that usage from run A never appears in run B (including sidebar summaries).
2. **Final reconciliation**: in `completeRun()`, after final flush, persist the authoritative accumulated value (already server-side authoritative — the client never computes tokens). Emit a final `usage` event so the last UI value equals the persisted value exactly.
3. **Error/stop/cancel paths**: ensure every terminal path (error, stop, interrupted, browser/test failure inside the loop) flushes pending deltas before status change; known usage must never be lost or reset. On `awaiting_input`, flush too.
4. **Refresh/reconnect**: `GET /api/sessions/:id` snapshot already returns `tokenUsage`; SSE reconnect + resync re-delivers latest state. Verify: refresh mid-run restores latest counts and continues receiving `usage` events; no reset to zero. Add `usage` payload to the SSE initial resync snapshot if not already included.
5. **Missing usage**: when a call yields no usage report and no estimate, leave counters unchanged (UI shows pending state — see Phase 3); do not write zeros over real values.

## Files
- `server/agent.js` (terminal paths, reconciliation), `server/app.js` (snapshot/SSE resync if needed), `server/store.js`.

## Acceptance criteria (running app)
- [ ] New run starts at 0/pending; previous run's totals never appear in a new run (header or sidebar).
- [ ] When a run finishes, displayed counts stop changing and exactly equal the persisted value (reload confirms).
- [ ] Failed and stopped runs retain all usage accumulated up to the interruption.
- [ ] Refreshing the page during an active run shows the latest counts (not zero) and counts continue updating.
- [ ] Two browser tabs / two concurrent runs each track their own counts independently.

## Tests
- Unit: terminal-path flush on error/stop; reconciliation emits final usage equal to persisted.
- Integration: kill/fail a run mid-stream → usage preserved; concurrent runs on same tenant → independent counters.
- E2E: refresh-during-run restores state and resumes live updates.
