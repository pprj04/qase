# Apple Device Matrix — build status

Plan approved 2026-09-29. Tickets #13433–#13447 (8 phases; #13434/#13436/#13439/#13441 are accidental duplicates of Phases 1/2/4/5 — ignore them, work the lower number).

## Phase 1 DONE (#13433) — Catalog data model
- Migration `server/postgres/migrations/016_device_catalog.sql`: GLOBAL (not tenant-scoped — deliberate deviation from spec, documented in file) catalog tables: device_categories, hardware, device_models (natural-key ids = ENV-ID slugs), device_generations (empty seed, admin-API hook), os_families, os_versions (`ios:18.3` ids), device_os_compatibility, browsers, browser_versions (`chrome:153` ids), browser_platform_support. environments gains screen_resolution, orientation, device_model_slug (backfilled from display_name).
- `server/deviceCatalogSeed.js` — derives rows from frozen catalog; a13–a19 + m1–m5 hardware; chip rules per model prefix.
- Backends: `server/localDeviceCatalog.js` (.qase/device-catalog.json) + `server/postgres/deviceCatalogRepository.js` — same contract: seed (idempotent upserts, never deletes), list, create, isCombinationSupported.
- Validation switchover: `normalizeEnvironmentInput` (environmentService.js) is now async, prefers catalogBackend.isCombinationSupported, falls back to frozen module. Postgres repo re-exports the shared one (its duplicate copy deleted — no import cycle). serviceFactory wires catalog BEFORE environment repo in both modes.
- Tests: server/deviceCatalog.test.js (6), server/postgres/deviceCatalogRepository.test.js (6). Suite: 602 pass / 8 skip / 0 fail.
- Known flakes: server/keepalive.test.js, server/drytisTransport.test.js — timing/nonce, unrelated, documented in memory.
- Reviewer + infra_verifier: PASS. Catalog-backed env create not yet exposed via REST (Phase 2).

## Next
- Phase 2 (#13435): catalog CRUD REST endpoints + env create with resolution/orientation + enable/disable. Spec file to write: .drytis/specs/phase-17-catalog-env-api.md
- Phase 3 (#13437) UI, Phase 4 (#13438) test cases, Phase 5 (#13440) bulk execution, Phase 6 (#13443) bugs, Phase 7 (#13445) coverage dashboard, Phase 8 (#13447) validation.
- env validation API responses use code QASE_ENVIRONMENT_INVALID (422) / QASE_ENVIRONMENT_CONFLICT (409). App auth: login required (authService), local run store, port 5173, service-bg-service-4182.
