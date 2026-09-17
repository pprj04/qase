# Fix: agent cannot publish the final report; runs must survive stop/restart

Ticket: #11273. User report (screenshot): `finish_qa_report` rejected 24× with
`QA checks are still running. Wait for their tool results before publishing.`
because one host-side activity (`call_3898c0212cf449f69c81e027`, `browser_click`)
stayed `status: "running"` forever after the process died mid-tool and the run
was auto-resumed on boot.

## Root cause

1. `server/qaTools.js` gates `finish_qa_report` on ANY `status === 'running'`
   activity — with **no staleness window**. The sibling finalizers
   (`sqaTools.js` `finishReadiness`, `founderTools.js` `founderFinishReadiness`)
   already treat a `running` activity older than 120 s as non-blocking. QA is
   the only mode that blocks forever.
2. The only abandonment path for host activities is `runTurn`'s turn-local
   `finally` sweep (`agent.js:749-760`). Process death (container pause,
   restart, crash) bypasses it, and nothing reconciles stale `running`
   activities on load (`store.js` `loadSessions`, `postgresServices.js` `load`,
   `runResume.js`). So an orphaned activity survives restarts indefinitely and
   permanently vetoes publish.

Forensic evidence (`.qase/sessions.json`, session `89ae3d71-…`): the stuck
activity `ts` is 2026-09-16 15:09:49 followed by a 2-hour gap — the process
died mid-`browser_click`; boot auto-resume continued the run but every one of
24 `finish_qa_report` calls carried `active_activity_ids: ["call_3898c0212cf449f69c81e027"]`.

## Changes (surgical, no behavior removed)

1. **`server/qaTools.js`** — mirror the 120 s recency window used by
   SQA/Founder in the QA publish guard. A `running` activity with a
   non-finite `ts` or older than 120 s no longer blocks publish; a fresh one
   still does (with the same `active_activity_ids` payload).
2. **`server/store.js` `loadSessions()`** — when a persisted session maps
   `running`/`awaiting_input` → `interrupted`, also fail its `running`
   activities in memory with `Interrupted by a server restart before this
   tool returned.` (mirrors the turn-end sweep's semantics).
3. **`server/postgresServices.js` `load()`** — same reconciliation inside the
   existing `run.recovered` commit so the Postgres store persists it.
4. **`server/runResume.js` `resumeAll()`** — defensive sweep before the
   recovery turn: any still-`running` activity on the resumed session is
   marked failed (covers stores/hybrids that skipped step 2/3; the recovery
   turn cannot await a tool call from a dead process).

## Files to change

- `server/qaTools.js` (guard)
- `server/store.js` (local load reconciliation)
- `server/postgresServices.js` (postgres load reconciliation)
- `server/runResume.js` (pre-turn sweep)
- `server/qaTools.test.js` (keep fresh-block test valid with a recent `ts`; add stale-allows-publish test)
- `server/store.test.js` (reload fails mid-flight activity)
- `server/postgresServices.test.js` (load recovery fails mid-flight activity)
- `server/runResume.test.js` (resume sweeps stale running activity)

## Acceptance criteria

- [ ] `finish_qa_report` publishes when the only `running` activity has
      `ts` older than 120 s (or a non-finite `ts`).
- [ ] `finish_qa_report` still blocks while a `running` activity is fresh
      (< 120 s) and still reports `active_activity_ids`.
- [ ] Local store reload maps a mid-run session to `interrupted` AND fails
      its `running` activities with the restart error; `done`/`failed`
      activities are untouched.
- [ ] Postgres load recovery persists the same reconciliation through
      `run.recovered`.
- [ ] Boot resume fails any still-`running` activity before the recovery turn.
- [ ] Full suite (`npm test`) passes; no other behavior changed.
- [ ] Live verification: restart the server with the real stranded session in
      `.qase/sessions.json`; the session auto-resumes and the report publishes.

## Out of scope

- Re-adding the reverted Sep-15 stream-unresponsive watchdog (rolled back per
  user instruction; not needed for this fix).
- Any UI, prompt, schema, env, or service changes.
