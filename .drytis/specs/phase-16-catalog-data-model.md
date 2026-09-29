# Phase 16 — Catalog Data Model: DB-backed Devices, Chips, OS & Browser Entities

Part of the Apple Device/OS/Browser Testing Matrix program (see tickets #13433–#13447).
Builds on the completed environment matrix (`.drytis/specs/apple-compat-matrix.md`).

## Goal

Move the Apple device/OS/browser catalog from the code-frozen module
`server/environmentCatalog.js` to DB-backed, manageable entities so that new devices,
chips, OS versions, browsers and browser versions can be added **through data** —
no application code change. Both persistence backends (Postgres + local JSON store)
implement the same catalog contract.

## Entities (migration 016)

Tenant-scoped (organization_id + project_id), RLS like migrations 002/003/015:

- `device_categories` — id, slug (ios-phone / ipad / mac), display_name, device_type (mobile/tablet/desktop), sort_order, created_at, updated_at
- `hardware` — id, chip slug/name (m1…m5, a14…a19 as needed), sort_order
- `device_models` — id, category FK, display_name ("iPhone 16 Pro"), slug, browserstack_device_name, screen_size, screen_resolution (new), is_real_device, hardware FK (nullable for iPhone/iPad where chip varies per model year — chip is optional metadata), created_at, updated_at
- `device_generations` — id, device_model FK, label ("M3", "3rd gen"), hardware FK nullable
- `os_families` — ios / ipados / macos with display names
- `os_versions` — id, family FK, version ("18.3"), display ("iOS 18.3"), major ("18"), sort_key
- `device_os_compatibility` — device_model FK + os_version FK (+ generation refinement, nullable)
- `browsers` — id, code (saf/chr/ffx/edg/opr/brv/ddg), display_name
- `browser_versions` — id, browser FK, version ("153"), sort_key
- `browser_platform_support` — browser FK + platform (ios/ipados/macos), supported boolean
- `environments` (extend existing table): add `screen_resolution`, `orientation`, FK refs to device_model, os_version, browser_version (keep existing flat columns + snapshot columns for backward compat)

## Local JSON store

`server/environmentService.js` — extend `createLocalEnvironmentBackend` with a catalog
sub-store (`.qase/environments.json` gains `catalog` section). Same repository contract
as Postgres: `catalogList(entity, filters)`, `catalogCreate`, `catalogUpdate`,
`isCombinationSupported`, `seedCatalog` (idempotent).

## Seed source

Seed all tables from the current frozen catalog (`server/environmentCatalog.js`) at
service startup — same pattern as the existing `environments.seed()`. Extend the frozen
catalog's iPhone/iPad entries with resolutions where available (device model viewport
maps to CSS px; keep `screen_size` as the physical label). The frozen module remains
the seed source for fresh installs; the DB becomes the runtime source of truth once
seeded. Existing ENV-IDs, environments and run snapshots must remain unchanged.

## Compatibility validation

Repository-level `isCombinationSupported(deviceModelId, osVersionId, browserId)`:
joins device_os_compatibility + browser_platform_support (+ Safari-version derivation
rule remains in catalog service logic). The environment create/update path switches
from frozen-module validation to repository-driven validation.

## Out of scope

- REST APIs for catalog CRUD (Phase 2)
- UI (Phase 3)
- Windows/Android

## Acceptance criteria

- [ ] Migration 016 applies cleanly on top of 015; local store seeds idempotently (double seed = no duplicates)
- [ ] All catalog entities readable via both store repositories
- [ ] `isCombinationSupported` on both stores: valid pairs true, invalid pairs false, data-driven
- [ ] Existing environments table rows untouched; ENV-IDs stable; `environment_snapshot` in qa_runs untouched
- [ ] Adding a device/OS/browser version via data (seed file or SQL/JSON insert) requires no code change
- [ ] Unit tests green: repository contract, seed idempotency, compatibility queries (node:test)
