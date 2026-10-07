# NI01 Phase 2 · Browser support resolution & capability truth

## Goal
Resolve, per (browser family, platform, version), whether the actual execution infrastructure can run it — and surface that truth everywhere. Extends the existing honesty contract in `server/catalogProviderRegistry.js` and the device-runtime provider registry (`server/deviceRuntime/provider.js`).

## Explicit resolutions required
- **Chrome**: local Playwright Chromium — SUPPORTED (SIMULATED). BrowserStack — supported where creds present.
- **Edge**: Playwright channel/msedge where available; else Chromium engine-equivalent, clearly labeled. BrowserStack supported.
- **Firefox**: Playwright Firefox (Gecko) — SUPPORTED locally per `engineForBrowser()` (browserstackProvider.js:93).
- **Safari**: Playwright WebKit — SUPPORTED as engine-equivalent locally (label: WebKit engine, SIMULATED); true Safari only via BrowserStack macOS/iOS REAL/VIRTUAL device.
- **Opera / Brave**: no branded engine in Playwright; BrowserStack does not offer them. Resolution: engine-equivalent execution allowed ONLY when explicitly labeled `SIMULATED · ENGINE-EQUIVALENT (Chromium)` in results — never presented as the branded browser passing on a real device. If a branded binary is later available, provider probe upgrades the status.
- **DuckDuckGo**: mobile-only browser; no Playwright build; not offered by BrowserStack Automate. Resolution = **NOT SUPPORTED**, reason surfaced in UI/coverage ("no execution provider can run DuckDuckGo"). Remains visible in catalog/matrix (product requires it) but can never be selected for execution as a run — selectable only to record intent, and always reports NOT SUPPORTED with reason. No fabricated results.
- **Version matrix**: versions come from runner capabilities (Playwright installed builds / BrowserStack capability list when creds exist), NOT hardcoded claims. `BROWSER_VERSIONS` in the catalog remains a curated *inventory*; executability is the provider's call at run time.

## Work
1. Add a capability resolution function (e.g. `resolveBrowserSupport(platform, browser, version, providerInfo)` → `{ status: 'supported'|'engine_equivalent'|'not_supported', reason, provider }`) in the catalog/provider layer; register local-runner capabilities there.
2. Expose via `GET /api/environments/availability` (exists) + `GET /api/catalog/meta` so UI columns show availability from one source.
3. Device+browser compatibility layer: for each platform, only generate/expose executable-or-inventory-marked combinations; Safari version derived from OS version (existing behavior — keep). DuckDuckGo REMAINS in the inventory on all five platforms it genuinely ships on (iOS, iPadOS, Android, Windows, macOS — DDG has desktop builds). Platform membership is inventory, NOT executability; DDG resolves NOT SUPPORTED everywhere regardless of platform, so it can never be presented as executable or passing anywhere. (Correction of an earlier draft line "DDG only ios/ipados/android" — that restriction was factually wrong; corrected during #14632 tester round.)
4. UI (matrixColumns.js / deviceRuntimeUi.js): render statuses — REAL DEVICE · AVAILABLE / BUSY / OFFLINE, SIMULATED · AVAILABLE, EMULATOR · AVAILABLE, VIRTUAL MACHINE · AVAILABLE, ENGINE-EQUIVALENT · SIMULATED, NOT SUPPORTED (with reason), UNAVAILABLE — from capability data, never hardcoded.

## Tests
- Unit tests for `resolveBrowserSupport` covering all 7 browsers × representative platforms.
- Endpoint test: DuckDuckGo environments always return `not_supported` + reason.
- UI snapshot: availability column reflects provider truth with no "REAL DEVICE · AVAILABLE" for anything not actually executable.

## Edge cases
- BrowserStack creds appear/disappear at runtime (env keys 52062/52063 currently null) — statuses must re-resolve on `/api/catalog/refresh`.
- Never cache a "supported" verdict across provider config changes without invalidation.

## Acceptance criteria (running app)
- [ ] DuckDuckGo shows NOT SUPPORTED with an explicit reason in the matrix and coverage UI, and can never appear PASSED.
- [ ] Availability column shows truthful provider-derived statuses; no fabricated REAL DEVICE availability.
- [ ] Opera/Brave, when run, are labeled engine-equivalent simulated, not branded-browser passes.
