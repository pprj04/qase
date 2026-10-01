# Ticket #14189: merge origin/DEV into NIHARIKA — blocked on conflicts

Status: merge attempted at checkpoint `ae6bfc6` (all #13972–#14166 work committed, NOT pushed), conflicted, `git merge --abort` run. NIHARIKA is 57 behind / 6 ahead of origin/DEV (66d7f85).

## Fetch quirk
`git fetch origin` (all refs) fails with "remote end hung up" (empty upload-pack response). Workaround: `git -c protocol.version=2 fetch origin DEV` succeeds. Remote token was rotated — origin URL reset to the one in init.json.

## 16 conflicted files, ~56 hunks
public/app.js (11), public/index.html (1), public/styles.css (17), server/app.js (6), server/app.test.js (3), server/browserBridge.js (3), server/browserMedia.integration.test.js (1), server/finalUiPolish.test.js (1), server/founderUi.test.js (1), server/localServices.js (5), server/postgres/migrations.test.js (6), server/postgres/runRepository.js (5), server/postgres/runRepository.test.js (1), server/postgresServices.js (2), server/qaTools.js (1), server/store.js (3).

## The hard product-level collisions (both sides define the same feature)
- **Dual bugs UI**: NIHARIKA `bugView.js` (Bugs tab, bug-filter-bar) vs DEV `bugsView.js` + `bugsView.css` (standalone exclusive-region view with own polling). Both exist in tree post-merge; index.html/app.js conflict over which stylesheet/wiring to use.
- **`createQaRun` signature**: NIHARIKA `{targetUrl, device, deviceLandscape, environmentId}` vs DEV `{targetUrl, device, deviceLandscape, selectedTests, securityAuthorization, kickoffText, engine, coreFlowsOnly}` — needs a real union.
- **store.js createRun validation**: NIHARIKA environment/testCase snapshot validators vs DEV engine-id validator (union is easy, but downstream must match).
- **server/app.js**: NIHARIKA environment/testCase resolution + device-runtime routes + list limit 20000 vs DEV analytics/track()/cohort block (both insertable, mostly union-able).
- **qaTools.js**: NIHARIKA `attestation` vs DEV `securityOutcomes` in the same summary object (unionable).
- **localServices.js**: divergent re-export lists from store.js (NIHARIKA adds persistSoon; DEV adds aggregateFindings/setFindingStatus) — needs union of both lists.
- **styles.css / cli-theme**: DEV's revert re-added theme layer NIHARIKA's UI-fix phases removed; many near-identical media-query hunks where HEAD should win per ticket but DEV may carry real fixes.
- DEV tip is post-React-revert (#14101 restored legacy UI, then `66d7f85` cleanup) — so public/ legacy files are live again on DEV.

## Ticket #14189 winner rules (from leader)
NIHARIKA/HEAD wins semantically for: server/environmentCatalog.js (2026.10.2), server/deviceCatalogSeed.js, list caps 20000 in server/app.js, server/environmentService.js, server/postgres/environmentRepository.js, public/app.js limit=20000 fetches, scripts/test-acceptance.mjs, scripts/validate-matrix.mjs, server/*.test.js + public/*.test.js from #14151/#14166. Others: keep BOTH functionalities, prefer our working product on genuine clash, escalate ambiguity.

## Stray files (untracked, intentionally NOT committed)
userDocs/image_df7e81c0.png, wait-ping-1.png — screenshots; consider adding to .gitignore pattern.
