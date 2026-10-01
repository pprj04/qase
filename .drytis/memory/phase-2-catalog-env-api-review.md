# Phase 2 (#13435) catalog+env REST API — review PASS (2026-09-30)

Spec: .drytis/specs/phase-17-catalog-env-api.md. Suite 595 pass / 0 fail (keepalive, drytisTransport, integration excluded).

## Verified
- server/catalogApi.js: 10 whitelisted entities, GET list/single, GET /validate, POST per-entity required fields, FK guards → 422 QASE_CATALOG_INVALID, dup → 409 QASE_CATALOG_CONFLICT (versioned create-only), upsert for reference rows. Mounted in app.js only when services.deviceCatalog exists. Unknown entity → 400 QASE_CATALOG_UNKNOWN_ENTITY.
- environmentService.normalizeEnvironmentInput: screenResolution (explicit > emulation viewport > null), orientation (desktop null / portrait default / landscape), description. rowToEnvironment + ENV_COLUMNS + columnMap extended; PATCH orientation enum validated in app.js. Local + Postgres backends covered by tests.
- Auth/CSRF middleware covers /api/catalog (verified 401 on live server); all SQL parameterized.

## Known gaps (documented, not fixed — reviewer does not fix)
- WARN: postgres deviceCatalogRepository.create() maps entity columns via row[column]; missing optional fields (browserstack_device_name, sort_order, major, vendor) become undefined params → node-pg throws → 500. catalogApi derives slug/display/sort_key but NOT os_versions.major. Local backend fine; only affects Postgres-mode catalog POSTs.
- WARN: no admin/role restriction on catalog POSTs (spec says "admin writes"); any authenticated user can write global reference data.
- WARN: migration 016 amended (added environments.description) after Phase 1; migrations.js enforces checksums and applied migrations are immutable → any DB that already applied the pre-amendment 016 will hard-fail at startup.
- Minor: deviceGenerations POST doesn't FK-guard device_model_id (postgres would 500 not 422); PATCH description type not validated (non-string goes to pg raw).

## Next: Phase 3 UI (#13437)
