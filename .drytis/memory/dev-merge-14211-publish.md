# DEV merge #14211 — NIHARIKA → DEV published (90f3d45)

Both branches at 90f3d45. Plain `git fetch origin` STILL hangs (stale-token from #14189); `git -c protocol.version=2 fetch origin DEV` works; plain push works fine.

## Topology (important for future merges)
Criss-cross: DEV had already absorbed NIHARIKA's work via cherry-pick — 6918e67 (= NIHARIKA's ae6bfc6 content) is ancestor of BOTH branches (parent of ae6bfc6 on NIHARIKA; second parent of DEV's 3a3dd17). Git's merge-base was 66d7f85 → ~17 noisy conflicts. Used `git merge-recursive 6918e67 -- f76a222 origin/DEV` (correct effective base) → far fewer, genuine conflicts. Must then `git rev-parse origin/DEV > .git/MERGE_HEAD` before committing (merge-recursive is plumbing).

## Resolution rulings (kept for consistency)
- **Migration numbering**: DEV's 001-029 scheme is canonical (see migration-renumber-hazard-14179.md). NIHARIKA-side dupes 023-030 removed; byte-identical to DEV's tree.
- **DEV tree won** (reviewed superset): browserBridge (remote engine.type on BrowserStack), localServices, postgresServices, runRepository(+test), migrations.test, contracts/fixtures (environments stubs), runEngineDevice.test (018/019), stageCollapseUi, targetReachability (hermetic chaseOverride).
- **NIHARIKA won**: store.js `statePaths()` lazy-cwd fix (#14189 — DEV still has frozen STATE_DIR bug!), environmentCatalog 2026.10.2 expansion + deviceCatalogSeed macOS back-catalog (#14151/#14166), activeRuntimeEnvironment viewForSelection, exec-layout viewer/chat grids, cli-theme scoping, env-body.json, frontend-ui-audit memory note.
- **UI**: NIHARIKA exec layout (ldv header/composer/viewer rows, no quick-actions/cd-* per #14102/#14132) + DEV's bugs-view section + nav (open-bugs, environments, device-matrix, test-cases, bulk-runs). `body class="cli-theme"` present.
- **Auto-merge dedupe traps** (git duplicated blocks): app.js followUp/qaKickoff imports, state object tail, renderFollowUps/renderDrytisBoard*/renderEvidenceSection duplicates; server/app.js analytics helpers; app.test.js store import. After ANY merge here, run a top-level-declaration duplicate scan + node --check on app.js/server/app.js.

## Verify
npm test 1078/0 (20 skipped). NIHARIKA-numbered DBs still need recreation (migration hazard note unchanged). `device-select` el ref is null-guarded legacy in both branches — not a bug.
