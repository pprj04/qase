# Phase 3 Device Matrix UI review (spec phase-18-device-matrix-ui.md) — 2026-09-29

**Verdict: FAIL** — UI scaffolding is solid but three backend endpoints the UI depends on DO NOT EXIST; verified live with authenticated session:

- `GET /api/catalog/facets` → 400 `QASE_CATALOG_UNKNOWN_ENTITY` (falls into the generic `/:entity` route; "facets" is not in ENTITIES whitelist). UI loads facets but never renders them anyway.
- `GET /api/catalog/deviceModels/:id/osVersions` → 404 (no such route in catalogApi.js; only `/:entity`, `/:entity/:id`, `/validate`). "OS versions" button per model always shows "No compatible OS versions recorded." — masked by `.catch(() => ({rows:[]}))`.
- `POST /api/environments/bulk` → 404 (no bulk route anywhere in server; environmentService has no bulkCreate). The "Create environments" button cannot work — clicking it shows a 404 toast.

Other gaps:
- UI never calls `/api/catalog/validate` (spec: multi-select "shows only valid combinations"); preview is a raw client-side cross-product. Builder also pairs `browsers` rows with `version: b.env_code` (not an actual browser version) — browserVersions dimension absent.
- No environment EDIT UI (resolution/orientation/description/provider) — environments tab is read-only + enable/disable toggle. Enable/disable works (PATCH wired, backend tested).
- Spec-named helper `buildEnvIds` / "env-id fallback" doesn't exist; 5 unit tests cover expandSelection/summarizeCombos/groupEnvironmentsByDevice/debounce (all pass).
- Catalog write forms POST /api/catalog/:entity with role gate owner/admin (catalogApi.js:169–173) — the only known test account (tester@qase.dev) is developer role → forms will 403 for it; flow unverifiable end-to-end with available creds.
- Dead code: deviceMatrixView.js:458 no-op `builderCreate?.addEventListener?.('click', () => {})`.
- Silent `.catch(() => ({rows:[]}))` on catalog loads masks 4xx/5xx as empty lists.

Good: XSS-clean (textContent everywhere, innerHTML only to clear; encodeURIComponent on path interpolation), CSRF token on writes via shared apiResponse, relative URLs only, existing environments modal untouched, full suite 621 pass / 0 fail / 9 skipped (known flakes), environments tab paginated (limit 50 server-side) + debounced search.

Test evidence: `node --test public/deviceMatrixView.test.js server/environmentApi.test.js` → 16/16; `npm test` → 630 tests, 621 pass, 0 fail, 9 skipped.
