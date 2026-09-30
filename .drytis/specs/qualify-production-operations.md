# Phase 10 · Qualify production operations (#12962)

## Goal
Close the operational gaps that block a qualified production deployment: Postgres
parity for engine/device fields, a deploy setup script that is complete and
auditable, undocumented env knobs, and a runbook that matches the REAL deploy
path (single Drytis pod on a git checkout, driven by backend tools).

## Changes

### 1. Postgres engine/device parity (core code fix)
- New migration `server/postgres/migrations/018_run_engine_device.sql`:
  - `ALTER TABLE qa_runs ADD COLUMN engine text NOT NULL DEFAULT 'chromium'`
  - `ADD COLUMN device text NOT NULL DEFAULT 'desktop'`
  - `ADD COLUMN device_landscape boolean NOT NULL DEFAULT false`
- `server/postgres/runRepository.js`: persist the three fields in
  insertAggregate + save; hydrate them in hydrateRun.
- `server/postgresServices.js`: accept and carry `engine` (validated through
  `isEngineId`) and `device`/`deviceLandscape` into the session object so they
  survive restart; app.js already passes them to `services.runs.create`.
- Validation: `engine` constrained to the known engine ids in repository code
  (defense in depth), `device` to device ids.

### 2. Unit tests without a live Postgres
Container has no Postgres (MariaDB only), so:
- `server/postgres/runEngineDevice.test.js`: pure unit tests over the
  repository's SQL/parameter mapping and hydration, using the existing test
  helpers/patterns (no live DB). Live integration remains gated on
  `QASE_TEST_DATABASE_URL` like `postgres/integration.test.js`.
- Test that the migration file follows the checksummed/transactional runner's
  contract (pure SQL, no destructive ops, ends with semicolon) by parsing it.

### 3. Setup script completeness
- Read the backend-managed setup script (`get_setup_script`), ensure it:
  installs deps, runs `npm run install-browser` (all three engines), keeps the
  GTK/Xvfb OS deps line, and runs `npm run db:migrate` **guarded** so local-store
  mode (no Postgres URL) skips it cleanly. Update via `update_setup_script`.

### 4. Documentation
- `.env.example`: add the undocumented vars with comments:
  `QASE_OPEN_REGISTRATION`, `QASE_ALLOWED_MODEL_HOSTS`, `QASE_DISABLE_XVFB`,
  `QASE_MODEL_TIMEOUT_RETRIES`, `QASE_MODEL_TIMEOUT_RETRY_DELAY_MS`,
  `QASE_INCOMPLETE_RUN_CONTINUATIONS`, `QASE_RUN_BROWSER_TESTS`.
- New `docs/operations-runbook.md` matching the actual single-pod deploy:
  deploy sequence, migration handling (local vs postgres), health/smoke checks,
  rollback (previous commit + restart), known environment quirks
  (split-horizon DNS, virtiofs .env workaround, Xvfb/WebKit), monitoring
  endpoints, analytics location, retention/governance pointers.

### 5. Configuration decisions (recorded, not flipped)
- `QASE_DRYTIS_INTEGRATION_ENABLED` stays `false` until #12961 closes.
- `QASE_OPEN_REGISTRATION` documented; production default remains closed.
- Decisions table added to the runbook.

## Acceptance criteria
- [ ] Migration 014 exists, pure SQL, forward-only compatible.
- [ ] runRepository writes + hydrates engine/device/device_landscape.
- [ ] postgresServices.createSession carries engine/device through.
- [ ] New unit tests pass without QASE_TEST_DATABASE_URL.
- [ ] Full `npm run verify` green.
- [ ] `.env.example` documents the 7 undocumented vars.
- [ ] `docs/operations-runbook.md` exists and matches prod-deploy-flow reality.
- [ ] Setup script updated and idempotent (guard for local mode).
- [ ] infra gate green; reviewer PASS.

## Out of scope
- Enabling Drytis integration (waits for #12961 user review).
- K8s baseline adoption, log shipping, backup automation (platform-owned).
- Multi-replica analytics.
