# Phase 1 — Launcher configuration catalog API & model

## Goal
Expose one server API that gives the Start QA launcher the complete, honestly-annotated
device–OS–browser–version configuration set, derived from the EXISTING catalog layers
(`environmentCatalog.js`, `catalogProviderRegistry.js`, `browserSupportResolution.js`,
`deviceRuntime` board). No new catalog data source; no hardcoded browser versions.

## Files to change
- `server/app.js` — new route `GET /api/qa-configurations` (auth-gated like `/api/environments`).
- New `server/qaConfigurations.js` (+ `.test.js`) — assembles the response:
  - environments (active only) from `services.environments.list`, each joined with
    `resolveBrowserSupport(browserCode)` status/reason/branded info, runtime-board
    availability, and provider overlay flags from `catalogProviderRegistry` /
    `/api/catalog/meta` providers (BrowserStack `connected:false` → rows stay builtin,
    provider reported as "Not configured").
- `server/environmentCatalog.js` — add `manufacturer: 'Apple'` to Apple device rows
  (field currently omitted; `manufacturerFor()` already derives it).
- Filters supported server-side (query params): platform, manufacturer, device, osVersion,
  browser, browserVersion, deviceType, executionType (physical/virtual/emulated), orientation,
  search, limit/offset — mirror the existing `/api/environments` facet contract.

## Response shape (contract for phases 2–4)
```
{
  configurations: [{ ...environmentRow, manufacturer, orientation, deviceType,
      executionType: 'physical_device'|'virtual_machine'|'emulator'|'simulator'|'browser_emulation',
      browserSupport: { status, reason, branded, detectedVersion, provider },
      availability: 'AVAILABLE'|'UNAVAILABLE'|'NOT_CONFIGURED'|'NOT_SUPPORTED' }],
  browserFamilies: [ // always all seven, in BRAND_ORDER
    { code, label, platforms, availableOnAnyPlatform, reasonWhenUnavailable } ],
  providers: [{ name, kind, connected, stale }],
  totals: { configurations, available, unavailable }
}
```
- Execution-type mapping (honest, from existing levels): `REAL_DEVICE`→physical_device,
  BrowserStack non-real→virtual_machine, local mobile profiles→emulator (browser emulation
  on desktop profiles→browser_emulation), engine-equivalent rows→simulator.
- DuckDuckGo: rows present, `browserSupport.status='not_supported'` with the existing
  reason string; family stays visible, never selectable.
- Provider version catalogs only — versions come from `BROWSER_VERSIONS`/provider overlays;
  the API must never invent or pin versions.

## Acceptance criteria
- [ ] `GET /api/qa-configurations` returns every active environment with browser support,
      availability and execution type; all seven browser families always listed.
- [ ] With no BrowserStack credentials, the response reports the provider as not configured
      and contains zero fabricated real-device rows.
- [ ] Every Apple row carries `manufacturer: 'Apple'`.
- [ ] Filter params work for platform, manufacturer, model, OS version and orientation.

## Tests
- Unit: assembly logic (join, execution-type mapping, family list, provider honesty),
  filters, empty/degraded cases (environments store failure → error payload, not 500).
- Regression: `/api/environments` unchanged.

## Edge cases
- Environment store throws → 503 with honest error (launcher shows retry).
- Browser catalog larger than limit → pagination meta; launcher fetches all pages.
- Board offline vs unknown → both `UNAVAILABLE`, reason preserved.
