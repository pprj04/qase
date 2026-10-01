# Phase 12 · Launch and maintain

Ticket #12964. Scope: close the launch-blocking and broken-promise gaps left
by phases 1–11 so the product can go live on the current single-pod, local-store
topology, with maintenance procedures that match reality.

## In scope

1. **Single-pod alert wiring for `/metrics`**
   - Set `QASE_METRICS_TOKEN` (dev + production scope) so `/metrics` mounts.
   - `deploy/observability/single-pod-alerts.md`: a self-contained alert
     definition (scrape-absence, 5xx burn on `qase_http_requests_total`,
     overload-rejection rate, oldest-queued age, expired leases, RSS ceiling)
     targeting the deployed topology, not the absent Prometheus-Operator one.
   - Update runbook §4 to point at it and record the token as configured.

2. **Retention execution for the deployed mode**
   - New `scripts/prune-local.mjs` (`npm run prune:local`): sweeps the local
     `.qase/` store — sessions older than `QASE_RUN_RETENTION_DAYS` (default
     30), their runsnapshots and workspaces; dry-run by default, `--apply` to
     execute; prints a summary. Never touches auth.json or invites.json.
   - Fix runbook §8: "automatic pruning" → honest description (manual command,
     documented cadence, restore drill step).

3. **Postgres parity (dormant backend, required for Drytis integration #12961)**
   - Migration `019_run_cohort.sql`: `ALTER TABLE qa_runs ADD COLUMN cohort text`
     (nullable, only ever 'pilot' or NULL).
   - `runRepository.js`: write/read `cohort` in insertAggregate, save,
     hydrateRun.
   - `postgresServices.js`: `listAll()` / `getAny()` unscoped accessors (same
     rationale comment as localServices) so `/api/analytics/feedback` reviews
     cross-user feedback on Postgres too.

4. **Invite mint rate limit (broken Phase 11 promise)**
   - `POST /api/auth/invites` gets a per-actor+route limiter (small fixed
     budget, e.g. 30/hour) — reuse the existing auth-throttle mechanics.

5. **CI engine parity**
   - `.github/workflows/verify.yml` installs `chromium firefox webkit`.

## Out of scope
- `QASE_STATE_DIR` env support (nice-to-have; deploy flow always starts from
  the repo root; tracked as follow-up).
- Backup automation/restore-drill tooling beyond runbook documentation.
- Opening registration (that's the pilot-gate decision, Phase 12 step 6,
  procedural — user's call).

## Acceptance criteria
- [ ] `/metrics` returns 200 with a bearer token on the running dev instance.
- [ ] `deploy/observability/single-pod-alerts.md` exists and covers the six
      signals; runbook §4 references it.
- [ ] `npm run prune:local -- --help` and a dry-run against the dev store work
      without mutation; `--apply` removes an injected aged session + snapshot +
      workspace in a temp fixture.
- [ ] Runbook §8 no longer claims automatic pruning.
- [ ] Migration 015 exists, is forward-only additive, and runRepository
      round-trips `cohort` (structural test against stub pool).
- [ ] `postgresServices` exposes `listAll`/`getAny`; feedback endpoint uses
      them on both backends.
- [ ] `POST /api/auth/invites` returns 429 after the budget is exhausted
      (integration test), 201 before.
- [ ] `verify.yml` installs all three engines.
- [ ] Full `npm run verify` green.

## Tests
- Unit: migration DDL assertions; runRepository cohort round-trip (stub pool);
  postgresServices listAll/getAny structural; rate-limit budget.
- Integration: pilotFlow-style test for invite 429; prune-local against a temp
  `.qase` fixture with an aged session.
- Infra gate + reviewer + tester (tester verifies /metrics token-gated and the
  app still launches + runs normally).
