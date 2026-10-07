# Review round 2: #14275 Catalog Phase 2 — all PASS (2026-10)

Suite 1104/1084 pass/0 fail/20 skip (reproduced). Round-1 FAIL + WARNs resolved.

## Round-1 FAIL fixed — Postgres seed
- postgres/environmentRepository.js seed() (l.82–183) now registry-sourced: dynamic import of catalogProviderRegistry, merges connected-provider overlays, filters PROV- rows, upserts them in the SAME transaction pre-reading id+active (l.135–159). `active` excluded from DO UPDATE SET (`refreshed` filter, l.99). Registry failure caught → builtin-only seed (l.96–98), never blocks.
- Retire UPDATE now has `AND env_id NOT LIKE 'PROV-%'` (l.171) — PROV- rows keep last-known state. Test at repo.test.js:275 asserts the NOT LIKE clause.
- Seed overlay idempotency test (repo.test.js:284) asserts providerRows=1, kept-uuid, active:false preserved, active not in SET list.

## Round-1 WARNs fixed
- WARN1: registerCatalogProvider(createBrowserstackCatalogProvider()) now BEFORE services.environments.seed() in both boot paths (serviceFactory.js 142→143, 227→228).
- WARN3: facets test (environmentService.test.js:101–106) asserts executionLevels non-empty/count>0 and providers facet builtin count === facets.total.

## Round-1 PASSes re-confirmed
rowCount fix (registry l.138), upsertProviderRow (l.327, guard/transactional/preserved, returned at l.419), local registry seed + PROV- retire skip (envService l.389–409), refreshCatalog rate limit, honesty contract, PROV- namespacing, no-creds→builtin-only, meta/refresh endpoints auth-walled (live 401 on both), fully parameterized SQL.

## Remaining WARN (carried, non-blocking)
- app.js:698 admin gate treats `!identity?.role` as admin — fine under embedded access layer, open if ever mounted anonymously.
