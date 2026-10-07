# Ticket #15123 — device catalog/panel audit + 3 fixes (NIHARIKA, unpublished)

## Audit result (no defect)
176 devices / 38,762 configurations verified: 5 platform groups (android 12,996 / ios 9,702 / ipados 7,854 / macos 6,006 / windows 2,204), phones+tablets+desktops+laptops+Surfaces all present, OS-version grouping per device, orientation facets (landscape 7,526 = desktops only; portrait 31,236 = phones/tablets), search, empty state, DuckDuckGo honestly disabled. Catalog has no plain "iPhone 15 Pro" — only Pro Max (not a bug).

## Fix 1 — execution-type badges all said "Virtual machine"
- Root cause: `environmentService.withExecutionMetadata` (server/environmentService.js ~line 274) stamps `executionType='VIRTUAL_DEVICE'` on EVERY row when no explicit level was requested. `qaConfigurations.executionTypeFor` honored `executionType` → all 38,762 rows = virtual_machine, so Emulator/Simulator/Browser emulation badges never rendered.
- Fix: `executionTypeFor` now reads only `executionLevelRequested ?? executionLevel` (explicit request); the blanket stamp is ignored. Result: simulator 19,534 / emulator 15,428 / browser_emulation 3,800.

## Fix 2 — "Galaxy Galaxy S24" / "Pixel Pixel Tablet" manufacturer labels
- Root cause: `withExecutionMetadata` derived Android manufacturer as first word of device name; `rowToEnvironment` dropped the catalog `manufacturer` field entirely.
- Fix: `rowToEnvironment` carries `manufacturer` through; `withExecutionMetadata` prefers `env.manufacturer ?? env.deviceManufacturer ?? fallback`. Manufacturer filter now lists real brands (Samsung 4,408 / Google 3,268 / OnePlus 836 / Xiaomi 836 …).

## Fix 3 — stuck "Loading device rows…" on session-expiry 401
- Root cause: `qaMatrixLoadWindow` in public/app.js had try/finally with no catch — a failed window fetch left the placeholder forever with no retry.
- Fix: honest error row + Retry button (dataset.role="window-error").

## Test gotchas
- `createLocalEnvironmentBackend` takes **stateDir** (not `dataDirectory` — silently ignored, falls back to real /workspace/.qase state which contains only 500 android rows). Always `await service.seed()` on a fresh temp dir. A pre-existing uncommitted test hit exactly this; fixed in environmentService.test.js.
- matrixApi.test.js can crash at Node boot with native `uv_thread_create` assertion under container thread exhaustion — infra, not code; passes standalone.

## Verification
Tests: environmentService 18/18, qaConfigurations 16/16 (3 new #15123 regressions), qaConfigMatrix 23/23, matrix* 31/31. Live API verified (Samsung Galaxy S24 emulator, Microsoft Windows Desktop browser_emulation, Google Pixel Tablet). Tester 7/7 PASS. Ticket #15123 → Done. Changes on NIHARIKA, NOT published.

## Known remaining (out of scope, reported to user)
- Pre-login 401s on the unauthenticated landing page (/api/environments, /api/device-runtime/devices, /api/auth/me) — cosmetic.
- "iPhone 15 Pro" (non-Max) absent from catalog.