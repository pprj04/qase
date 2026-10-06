# Merge MANOJ → DEV, coverage selection UI/UX (follow-up to #14471)

- Merge commit: **7444c0e** (`Merge MANOJ: UI & User Experience coverage selection (grouped UI, persisted scopeSelection, What was tested reports)`), pushed f04f78d..7444c0e.
- **Important pre-step**: local DEV was at old-history 9bd01a0 which is NOT an ancestor of the rewritten origin/DEV f04f78d (#14473 re-merged onto production base 66d7f85, React rebuild reverted, NIHAREKA+PUSHKAR removed). Fixed by `git branch -f DEV origin/DEV` (old commits remain in reflog). Do not assume local DEV == origin/DEV; check `git rev-list --count origin/DEV..DEV` first.
- Migration renumber: MANOJ's `021_run_scope_selection.sql` → **`023_run_scope_selection.sql`** (DEV already had 021_qa_test_selection + 022_security_authorization). Also updated: header comment "migration 023", `server/postgres/scopeSelectionRepository.test.js` (readFileSync path + test name), `server/postgres/migrations.test.js` all counts to 23 (order list, applied versions, currentVersion 23, BEGIN/COMMIT 23, records `[23, 'run_scope_selection']`, scope_selection assertions moved to migrations[22]).
- Conflicts resolved (all additive unions — both DEV's test-selection/security-authz and MANOJ's scopeSelection kept):
  - `public/app.js`: `createQaRun` signature/body (selectedTests+securityAuthorization+scopeSelection in POST /sessions body, scope passed as `scopeSelection: scopeValues` at the engine loop call site).
  - `server/app.js`: POST /api/sessions — `normalizeQaScopeSelection(request.body?.scopeSelection)` spread into runs.create options.
  - `server/store.js`: both validation blocks (selectedTests/securityAuthorization + scopeSelection normalize).
  - `server/postgres/runRepository.js`: insertAggregate column list `... cohort, scope_selection, created_at...paused_at, selected_tests, security_authorization` with VALUES $30; loadAll/get SELECT lists get `scope_selection` appended (list() already had it via MANOJ auto-merge).
  - `server/postgres/migrations.test.js`: as above.
- Tests on merged tree: 793 tests, 771 pass, **2 fail** (known: scripts/test-browser-efficiency.mjs, server.corrupt-*/progressStream.test.js), 20 skipped; targetReachability split-horizon passed this run.
- Workspace left on MANOJ @ 2fae929, clean, up to date with origin/MANOJ.
- Production note: DEV history rewrite means deploys now come from the 66d7f85-based line; scope_selection migration will apply as version 23 on prod.
