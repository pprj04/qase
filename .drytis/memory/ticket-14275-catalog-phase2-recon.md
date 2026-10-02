# Recon #14275 Catalog Phase 2 (branch NIHARIKA, HEAD 90f3d45, uncommitted)

## EXISTS (uncommitted working tree)
- `server/catalogProviderRegistry.js` (165 lines): registerCatalogProvider/unregisterCatalogProvider/registeredCatalogProviders, providerEnvId (`PROV-<SLUG>-`), normalizeProviderRow (honesty contract — invalid executionLevel rows dropped, never guessed), mergeCatalog (additive, builtin verbatim first, dedupe, attestations when rawId matches builtin, stale=true on fetch throw), catalogProviderMeta.
- `server/browserstackCatalogProvider.js`: createBrowserstackCatalogProvider + mapBrowserstackEntry, config-gated via browserstackCredentials(), /v5/browsers endpoint, injectable fetcher. Fixture tests exist (`browserstackCatalogProvider.test.js`, 5 tests, recorded fixtures only).
- environmentService.js: `upsertProviderRow` (l.451, PROV- guard, preserves active), `refreshCatalog` (l.588, 1/min rate-limit l.497, upserts only PROV- rows, registryModule injectable). Facets extended with `executionLevels` (l.535) and `providers` (l.545).
- app.js: `GET /api/catalog/meta` l.683 (read-only, no-store, no auth gate beyond global /api middleware), `POST /api/catalog/refresh` l.695 (403 unless role owner/admin via request.auth). `GET /api/environments/facets` l.665.
- serviceFactory.js l.13-14,143,227: registers createBrowserstackCatalogProvider in both paths.
- Phase 1 state confirmed: ENVIRONMENT_CATALOG_VERSION '2027.01.0', 163 devices / 36,619 envs (see ticket-14273 review memory).

## GAPS / remaining work
1. **Postgres backend has NO upsertProviderRow** — refreshCatalog no-ops on Postgres (`typeof === 'function'` guard silently skips). Need server/postgres/environmentRepository.js implementation (mirror Phase 1's active-preserving upsert pattern).
2. **Seed path does NOT source from registry** — seed() at environmentService.js:357 still calls generateEnvironments() directly; spec says seed should merge builtin + provider overlays.
3. **No API-level tests** for GET /api/catalog/meta or POST /api/catalog/refresh (nothing in app.test.js/environmentApi.test.js); app.test.js:313 facets stub lacks executionLevels/providers keys (still passes but drifts).
4. No service-level tests for refreshCatalog (rate-limit, PROV--only upsert, injectable registry) in environmentService.test.js.
5. Attestation merge policy: registry records attestations but never flips builtin rows (spec allows caller-level merge — decide/document).
6. All work uncommitted on NIHARIKA — commit checkpoint advisable.

Tests not run (read-only recon); suite was 1059 pass at Phase 1 review.
