# Phase 3 Round 2 Re-Review — Apple Device Matrix UI

Verdict: **PASS**. All round-1 FAIL items fixed and verified live (authenticated as tester@qase.dev).

Round-1 failures and their fixes (verified 2026-09):
1. Missing endpoints — all four implemented and live-verified:
   - `GET /api/catalog/facets` → 200 with counts (39 models / 12 OS / 7 browsers)
   - `GET /api/catalog/deviceModels/:id/osVersions` → 200, compat-table resolution (IP11 → 3 iOS versions)
   - `GET /api/catalog/browsers/:id/versions` → 200
   - `POST /api/environments/bulk` → 201, per-combo validation via `normalizeEnvironmentInput` → same `isCombinationSupported` path as `/validate`; invalid/skipped with reason (firefox-on-ios → QASE_ENVIRONMENT_INVALID "Browser firefox is not available on ios"); dup → CONFLICT skip; cap 500 → 422.
   - `POST /api/environments/bulk-toggle` → 200, envIds array validation (400), cap 1000, unknown ids in `missing[]`.
2. Builder validates server-side — cross-product sent to `/environments/bulk`; each combo validated via catalog backend.
3. Browser versions real — lazy-fetched per browser via `/catalog/browsers/:id/versions`, each browser+version is a dimension entry.
4. Environment edit UI — `openEnvEditor` in deviceMatrixView.js (screenResolution, orientation select, description, executionProvider), PATCHes existing endpoint; invalid orientation → 400 (verified live).
5. Facet failure visible — `#dm-facet-summary` renders counts; still defaults to "Loading catalog…" on total failure (residual WARN).
6. Dead no-op listener — removed.
7. refreshFacets — renders into #dm-facet-summary.

Tests: 29/29 targeted, 635 total / 626 pass / 0 fail / 9 documented skips.

Residual WARNs (minor, non-blocking):
- Builder `device` field sends human display name (`combo.deviceDisplay`) not slug — works because env validation accepts display names via `getDevice()`, but a display_name rename would silently break matrix combos; slug would be more robust.
- `osVersion` id parsing in UI uses `split(':')` on the catalog `ios:18.3` id format — works but is string-format-coupled.
- Total catalog-read failure still degrades to "Loading catalog…" text (facet summary) rather than an explicit error state.
- `buildEnvIds` (spec's named helper) still doesn't exist; env-id derivation is server-side only — spec text is ahead of code.
- `fillCategoryFilter` uses one static innerHTML option string (no user data) — not an XSS vector.
