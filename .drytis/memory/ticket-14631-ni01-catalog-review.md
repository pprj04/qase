# Review #14631 NI01 Phase 1 catalog (2027.03.0) — ROUND 3: verdict PASS

Rounds 1 (FAIL: migration 030 SQL backfill collisions) and 2 (PASS with WARNs)
are history; round 3 re-verified everything against the current working tree
(now also carrying #14632 browser-support and #14633 matrix_runs work).

## Round 3 re-verification (all confirmed)
- Migration 030 DDL-only: only `ALTER TABLE … ADD COLUMN profile_id text` +
  non-unique partial index `environments_profile_id_idx`; zero data mutations.
  Guard test (migrations.test.js:59-65) asserts no /\bUPDATE\b/ in migration 30.
- Migration set is now 1..31 (031_matrix_runs from #14633); migrations.test.js
  updated (ordered lists, currentVersion 31, names incl. matrix_runs).
- Seed write path: COLUMN_TO_FIELD/columnValue used in seed builtin loop (142),
  create (263), upsertProviderRow (368). Independent simulation: 38,762 rows,
  0 null profile_id params, 38,762 distinct profile ids, no unexpected NULL
  columns (only legitimately-optional ones: description, permission_scenario,
  orientation_scenario, execution_level_requested, desktop orientation).
- Custom-env suffix verified live: `ENV-CUSTOM-42` →
  `iphone17pro-ios26-safari26-envcustom42` — cannot equal any builtin alias.
- Catalog uniqueness: 38,762 envIds / 38,762 profileIds, 0 dupes.
- Append-only vs HEAD baseline (2027.01.0, 36,619 envs): 0 removed, 2,143 added.
  (Note: origin/DEV does not contain environmentCatalog.js at all — the entire
  catalog file is uncommitted working-tree state.)
- Tests: targeted 61 pass/0 fail; full suite 1,179 pass / 0 fail / 20 skipped
  (1,199 total); validate-matrix ALL CHECKS PASSED (live-API checks need auth
  cookie — pre-existing skip).
- No secrets/preview URLs/DB creds in the changed files (grep clean).

## Standing WARNs (unchanged)
- seed() provider-overlay loop (~line 170) uses columnValue now — the round-2
  WARN about raw env[column] is RESOLVED in current code.
- Migration 030 still never executed against real Postgres in tests (FakeClient
  only) — low risk, DDL-only.
- NO unique constraint on profile_id: DB permits duplicates; uniqueness is by
  JS determinism only — deliberate, documented in the migration comment.
- ENTIRE 2027.03.0/#14632/#14633 change set remains UNCOMMITTED on the
  NIHARIKA working tree; origin/DEV (f04f78d) lacks environmentCatalog.js
  entirely. Publish before any redeploy/recreation or everything reverts
  to 2027.01.0-era state.
