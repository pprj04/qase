# Phase 3 UI infra verification (2026-09-29) — round 2: RESOLVED

Round 1 FAIL: UI-called endpoints (facets, deviceModels/:id/osVersions,
environments/bulk, bulk-toggle) did not exist.

Round 2 (same day): all endpoints implemented and verified live with the
tester@qase.dev (developer) account from .drytis/cred.json:

- GET /api/catalog/facets → 200 (counts: 39 models, 12 osVersions, 7 browsers, categories/osFamilies breakdown)
- GET /api/catalog/deviceModels/IP16PRO/osVersions → 200 (3 iOS versions)
- GET /api/catalog/browsers/:id/versions → 200
- POST /api/environments/bulk {"combinations":[]} → 201 {created:[],skipped:[],total:0}
- POST /api/environments/bulk-toggle {envIds:[missing]} → 200 {updated:[],missing:[...]}
- POST /api/catalog/deviceModels (dev role) → 403 "Catalog writes require an owner or administrator." — role gate works.

Implementation: server/catalogApi.js:118 (facets), :148 (model osVersions);
server/app.js:431/445 (bulk, bulk-toggle — mounted BEFORE /api/environments/:envId);
server/environmentService.js:365 (bulkCreate), :384 (bulkToggleActive). UI now
renders facet summary (deviceMatrixView.js:114) and environment editor (line 366+).

All other checks clean: env parity (20/20 keys), no dev processes, preview 200
real app, Caddy root→5173 bound by service pid, setup script OK, migrations
only in migrations dirs, no hardcoded secrets/URLs (validate-matrix.mjs uses
QASE_PUBLIC_URL fallback — stays fixed). RESULT: PASS.

Known standing WARN (unchanged): /workspace/.env.example committed without
backend env_key representation (placeholder-only, low risk).
