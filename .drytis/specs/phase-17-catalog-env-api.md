# Phase 17 — Catalog & Environment APIs: CRUD, Validation, Resolution & Orientation

Ticket #13435. Builds on Phase 16 (migration 016 catalog tables + two backends).

## Goal

Expose the DB-backed catalog and the upgraded environment entity through REST:
every catalog entity creatable/readable via API (so new devices/OS versions/
browser versions need zero code changes), environment create extended with
screen resolution + orientation, enable/disable, and rule-driven validation.

## Endpoints (server/app.js, alongside the existing /api/environments routes)

Catalog read (all global reference data):
- `GET /api/catalog/:entity` — list rows; whitelisted entities: deviceCategories,
  hardware, deviceModels, deviceGenerations, osFamilies, osVersions, browsers,
  browserVersions, deviceOsCompatibility, browserPlatformSupport. Query params
  are exact-match filters on whitelisted columns. 400 on unknown entity.

Catalog create (admin writes; validation per entity):
- `POST /api/catalog/deviceModels` — display_name, category_id, slug (derived
  if absent), screen_size, screen_resolution, is_real_device, hardware_id;
  409 on duplicate slug.
- `POST /api/catalog/osVersions` — os_family_id, version, display (derived),
  sort_key (derived); 409 on family+version duplicate.
- `POST /api/catalog/browserVersions` — browser_id, version; 409 on duplicate.
- `POST /api/catalog/hardware` — id, display_name.
- `POST /api/catalog/deviceOsCompatibility` — device_model_id, os_version_id;
  409 on existing pair.
- `POST /api/catalog/browserPlatformSupport` — browser_id, platform, supported.
- `POST /api/catalog/browsers` — id, display_name, env_code, independently_versioned.
- `POST /api/catalog/deviceCategories`, `/api/catalog/osFamilies` — id-based reference rows.
- `GET /api/catalog/:entity/:id` — single row.
- All writes return the stored row; upsert semantics for reference rows,
  create-only for versioned rows (duplicate → 409 QASE_CATALOG_CONFLICT).

Compatibility:
- `GET /api/catalog/validate?device=<slug>&platform=…&osVersion=…&browser=…&browserVersion=…`
  → `{ ok: true }` / `{ ok: false, reason }` from the DB-driven check.

Environment extensions (existing routes, additive only):
- `POST /api/environments` body may include `screenResolution` and
  `orientation` (portrait|landscape). Resolution defaults from the device
  model's screen_resolution; orientation defaults to portrait for
  mobile/tablet and is omitted (null) for desktop.
- `PATCH /api/environments/:envId` now also accepts `screenResolution`,
  `orientation`, `description`.
- `active` flag toggle (enable/disable) already exists — verify it works and
  that disabled environments are excluded from run-start pickers
  (`GET /api/environments?active=true` is the picker query).
- Existing endpoints' response contracts otherwise unchanged.

## Error model

- 400 QASE_CATALOG_UNKNOWN_ENTITY, 422 QASE_CATALOG_INVALID (missing/invalid fields),
  409 QASE_CATALOG_CONFLICT, 404 for missing ids, 422 QASE_ENVIRONMENT_INVALID
  and 409 QASE_ENVIRONMENT_CONFLICT (existing codes) for environment routes.

## Tests (server/environmentApi.test.js + new server/catalogApi.test.js)

- Catalog list per entity (seeded content), unknown entity → 400
- Add deviceModel via API → appears in list; duplicate slug → 409
- Add osVersion (iOS 26.1) via API → validate iPhone 16 Pro + iOS 26.1 + Chrome works
- Add browserVersion (Chrome 154) via API → environment create with it succeeds (422 before)
- Compatibility endpoint: valid pair true; iPhone+macOS false; Firefox+iOS false
- Environment create with explicit resolution/orientation persisted; defaults for mobile vs desktop
- PATCH resolution/orientation; disable → picker excludes → enable → returns
- Backward compat: environment list/get responses unchanged in shape for existing rows

## Out of scope

- UI (Phase 3), test cases (Phase 4), coverage (Phase 7).

## Acceptance

- [ ] All catalog entities listable + creatable via API without code change
- [ ] Device/OS/browser added via API immediately usable in environment create
- [ ] Environment create validates through DB rules; 422/409 codes preserved
- [ ] screenResolution + orientation persisted, defaulted by device type
- [ ] PATCH supports resolution/orientation/description + existing fields
- [ ] Enable/disable excludes/returns environments in picker queries
- [ ] Existing environment API contracts unchanged (regression tests pass)
