# #14151 Catalog expansion (Done)

Data-only expansion of server/environmentCatalog.js:
- BROWSERS[].platforms expanded (2026-10-01): ios/ipados/macos = all 7 browsers; android/windows = 6, Safari NEVER. Catalog version 2026.09.1 → 2026.10.1. generateEnvironments() → 3650 unique envs, 79 devices.
- All requested devices/OS versions ALREADY existed (added earlier); this ticket was availability + capacity + search only.
- Capacity: list caps 1000 → 5000 everywhere (postgres envRepository LIMIT clamp, environmentService memory list + facets, /api/environments validation 1..5000, public/app.js fetches limit=5000). 3650 < 5000 fits without pagination.
- Picker search: filterDeviceCards haystack now includes all card.browsers names (so 'Firefox' finds Firefox-capable devices); filter is not exclusive — a browser search keeps non-matching devices if the name matches? No: it filters by haystack match; 'Firefox' matches every device that supports Firefox.
- scripts/validate-matrix.mjs: checks 2/5 fixed to read runtimeCapabilities (field renamed in #13780); check 6 now only forbids Safari on Android/Windows.
- DB catalog (migration 016, deviceCatalogSeed.js) derives availability from BROWSERS[].platforms, so it expanded automatically; no SQL migration needed.
- Seeding idempotent by envId, never resets active=false (operator deprecations survive).
- Login throttle (429, in-memory, 10/15min) bit hard this session — every probe/acceptance run restarts a login. procmgr restart service-bg-service-4182 clears it.

Reviewer WARNs (left, not fixed): resolveDeviceEnvironment grew an executionLevel param (leaked from another ticket's DX work, additive/unused); stale browserstackCapabilities refs in browserstackProvider.js + deviceRuntime/browserstackRuntimeProvider.js:34-36; matrix-size test asserts range 3000–5000 not exact 3650.

Changes UNPUBLISHED on NIHARIKA (with #14102, #14132 work).