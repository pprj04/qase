# Phase 2 mission/run/report consistency audit

Mission status is persisted in `missions.json` as created, queued, running,
completed, failed, aborted, cancelled, timeout, or interrupted. Session status
is independently persisted in `sessions.json` as idle, running, awaiting_input,
done, error, or interrupted. Execution health separately tracks provider,
worker, browser and target components plus an overall state. Structured reports
carry verdict, executionOutcome and outcomeReason; generated Markdown reports
may exist even when execution did not complete. Findings are present in session,
mission and canonical finding stores, while evidence and artifact registries are
linked by mission/session identifiers. The frontend historically interpreted
these fields independently.

Contradictions found: report existence was not itself tied to terminal success
but some consumers lacked one normalized outcome; provider/browser failure and
session error could coexist with a report; post-run analysis could increase or
deduplicate the finalized finding set after the report's numeric count was
authored; mission and session APIs therefore could display different counts.

Canonical precedence is: intentional cancel/abort; timeout or incomplete
budget closeout; blocked browser or pre-execution provider failure; fatal
execution/session/mission failure; successful completed mission plus done
session. A report is independent metadata and never overrides failure. Provider
failure after successful browser steps is failed rather than blocked and keeps
its evidence/report. Restart-stale sessions are interrupted and normalize to a
terminal failure. Canonical finding counts deduplicate stable finding IDs across
session and mission collections and exclude records explicitly marked as merged
or duplicate. Count-bearing APIs label current canonical counts; paginated
finding APIs retain their existing raw `total` and add a labeled canonical total.
Authored report snapshots are preserved separately from the synchronized current
count.

The policy is additive and backward compatible: existing status fields and
transition rules remain unchanged. New normalized outcome metadata is derived
at API/finalization seams; no stored history migration or destructive rewrite
is performed. Historical terminal missions without the new metadata derive from
their existing terminal status unless a linked session or execution-health fact
proves a higher-precedence non-success state.
