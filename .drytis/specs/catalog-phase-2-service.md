# Phase 2 · Dynamic catalog service + provider integration surface

Goal: make the catalog a service-fed, extensible source instead of a frozen list — without changing any UI. The existing `environmentService` (file/Postgres backends) stays the read path; this phase adds a **provider-aware catalog layer** behind it.

## Changes

### `server/catalogProviderRegistry.js` (new)
- Registry of catalog sources: `builtin` (the expanded static catalog from Phase 1) always present, plus optional external providers (e.g. BrowserStack) registered via config/env.
- Each provider exports an async `fetchCatalog()` → normalized `{ devices, osVersions, browsers, availability, executionLevels, providerInfo }`.
- **Honesty contract**: a provider entry may only report `executionLevel: REAL_DEVICE` / availability for combos the provider itself confirms; registry merges provider rows as ADDITIVE overlays (envId namespaced `PROV-<slug>-…`) and can flip `availability`/`executionLevelRequested` for matching builtin rows when the provider attests them.
- No credentials configured → registry returns exactly the builtin catalog; app behavior unchanged. Never fabricate rows.

### `server/environmentService.js`
- Seed path now sources from the registry (builtin first, provider overlays after) — seeding stays idempotent, never resets `active`, logs provider merges.
- Add `refreshCatalog()` (manual/API-triggered, rate-limited) that re-fetches provider overlays and upserts only provider-scoped rows; builtin rows untouched.
- Facets endpoint extended with `providers` and `executionLevels` facets (existing facets untouched).

### `server/app.js`
- `GET /api/catalog/meta` → `{ catalogVersion, providers: [{name, connected, rowCount}], generatedAt }` (read-only, no secrets).
- `POST /api/catalog/refresh` (admin-gated) → invokes registry refresh.

### BrowserStack provider adapter (thin, config-gated)
- If `BROWSERSTACK_USERNAME`/`BROWSERSTACK_ACCESS_KEY` exist, adapter queries BrowserStack's public browser/device list endpoint, maps to catalog overlay rows with REAL_DEVICE/VIRTUAL_DEVICE levels from actual capability data. Without creds: registered but `connected:false`, contributes nothing.
- Absent infrastructure → adapter is inert; do not simulate results.

## Rules
- UI consumers (devicePicker, app.js) continue calling existing routes — no frontend changes in this phase.
- Env limit caps unchanged here (Phase 5).
- Deterministic tests: registry with fake in-memory providers (merging, namespacing, honesty rules, refresh idempotency); BrowserStack adapter tested against recorded fixtures only, never live.

## Edge cases
- Provider temporarily unreachable → builtin catalog remains authoritative, provider rows keep last-known state, `meta` shows stale flag.
- Provider row conflicting with builtin (same device/os/browser): keep both (namespaced envIds), rankEnvironments already prefers attested levels.
