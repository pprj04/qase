# Token counting feature (tickets #12469–12471, branch NIHARIKA, 2026-09-22)

Implemented per-run token counting in QASE-2.1. Full verification done (reviewer + tester PASS).

## Architecture
- `session.tokenUsage = {inputTokens, outputTokens, totalTokens, cachedInputTokens, estimated, updatedAt}` — persisted as `qa_runs.token_usage` jsonb (migration 013) in PG mode and plain JSON in local mode. Mirrors `contextUsage`/`context_usage`.
- `server/usageCapture.js` — the capture core. Two instance-level hooks into the vendored `@cleanslate/sdk` (no fork):
  1. `attachUsageCapture(runtime.cleanSlateService, ...)` wraps `logProviderReportedUsage` — the SDK calls it for EVERY provider with normalized usage right before dropping it. This is the ONLY real-usage source.
  2. `createUsageLogger({...})` injected as the runtime `logger` option — parses only the SDK's `stage=complete` chars/4 estimate line. It deliberately does NOT parse the `[CleanSlateAzureDebug]` line: that line carries the SAME report as hook 1, so harvesting both double-counts Azure (real bug the reviewer caught; regression test exists).
- `commitTurnUsage()` in agent.js runTurn: folds harvest into session.tokenUsage (`applyUsage`, real beats estimate), commits event `usage` with `{usage, mode}`; called post-stream-loop, inside completeRun(), and first thing in catch.
- UI: badge `19k tok` on run rows (run-list payload carries tokenUsage), header chip `15.4k in · 3.6k out tok` (+ `· N% ctx` when contextUsage present), SSE `usage`/`context` events update live. formatTokens trims trailing zeros.
- Reports: `- **Tokens:** X prompt / Y completion / Z total (estimated)` line in buildReportMarkdown + reportPdf headerBlock, only when tokenUsage exists (old runs unchanged).
- Metrics: `qase_model_tokens_total{kind,mode}` counter in operations.js, fed by index.js's global run-bus subscription.

## Landmine defused along the way
- `services.events.subscribeGlobal` existed in name only — nothing ever surfaced it, so both the metrics wiring AND the keepalive run-bus signal were dead in ALL modes (keepalive survived via isActive() fallback). Fixed: localServices surfaces it from runStore, postgresServices from the Redis eventTransport (which gained subscribeGlobal on its '*' bus).
- Residual gap: PG standalone mode (postgres store WITHOUT distributed execution/Redis) still has no global event hook. Not used by this project's deployments; note if PG-standalone is ever exercised.

## Gotchas
- Local sessions.json: a separately-seeded file write gets clobbered by the running server's shutdown flush — stop the service before editing, or commit via services API.
- Test account for browser tests: /workspace/.drytis/cred.json (tester@qase.dev). App listens on :5173; login sets cookies (no Bearer), CSRF header needed for mutations.
- App tests: full suite `npm test` (507 pass as of close).
