# Review: #15013 Phase 2 launcher matrix UI + windowed catalog (branch NIHARIKA, uncommitted)

Verified 2026-10. Tests 39/39 green; API honest (38762/37244/1518); default payload 158KB, index 306KB gzipped (SSE-crash fixed); browser-test PASS 8/8.

## New finding: iPadOS manufacturer = "Microsoft" (data bug, pre-existing, user-visible now)
- 7,854 ipados rows carry manufacturer "Microsoft" in /api/qa-configurations index
  (e.g. ENV-IPADOS-IPAD10-15.0-BRV-136 → "Microsoft iPad (10th Gen)").
- Root cause: server/environmentService.js:295 `deviceManufacturer` ternary covers
  ios/macos/Android but OMITS `ipados` → falls to the final `: 'Microsoft'` branch.
- qaConfigurations.js:140-143's correct Apple fallback (regex includes ipados) never
  applies because env.deviceManufacturer ("Microsoft") takes precedence.
- server/qaConfigurations.test.js "Apple rows carry manufacturer=Apple" passes because it
  tests generateEnvironments() directly, bypassing the service enrichment.
- Fix belongs in environmentService.js (add `env.platform === 'ipados'` to the Apple
  branch). Fixing it in qaConfigurations.js fallback order would also work but is the
  wrong layer. NOT fixed by reviewer (review-only).

## Other notes
- All 38,762 catalog rows currently executionType=virtual_machine → only "Virtual machine"
  badge appears in practice; the 5-way executionTypeFor mapping is unit-tested but not
  exercised by live data (Phase 1 territory).
- app.js qaMatrixLoadWindow shadows global `window` with `const window =` (works, risky style).
- Client search haystack includes browserVersion+envId; server search haystack does not
  include browserVersion → tiny count drift possible between checklist math and windowed tree.
- Spec's DOM-level tests (scroll containers scroll, no clipping at 1280/1024) not in the
  unit suite; covered only by the live browser test.
- server/app.js applies securityHeaders middleware twice (before+after compression) — harmless.
- Phase 3 gap unchanged: submit runs only selectedEnvIds.slice(0,1) (see
  qa-matrix-gap-recon-15013.md).
