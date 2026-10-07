# Review — Ticket #14151 catalog expansion (NIHARIKA branch, uncommitted worktree)

Reviewed 2026 on top of #14132's uncommitted changes (same dirty tree). Verdict: PASS, 3 WARNs, 0 FAILs.

## Verified
- server/environmentCatalog.js diff is data-only (39 lines): BROWSERS[].platforms now ios/ipados/macos get all 7 browsers, android/windows get 6 (no Safari); ENVIRONMENT_CATALOG_VERSION → '2026.10.1'; no device/osVersions/BROWSER_VERSIONS/buildEnvId/buildEnvironment changes.
- generateEnvironments() → 3650 envs, 3650 unique envIds; per-platform families verified (ios 1520, ipados 320, macos 100, android 1596, windows 114; Safari only on Apple platforms).
- validate-matrix.mjs: checks 2 & 5 read runtimeCapabilities; check 6 only forbids Safari on Android/Windows. Full run: ALL CHECKS PASSED (live API checks 8–13 skipped, expected).
- Limits: postgres repo LIMIT clamp 1000→5000 (SQL param validated by test); environmentService memory list clamp + facets limit 5000; server/app.js limit ≤5000 with 400 message updated; public/app.js fetches limit=5000 (3 sites).
- devicePicker filterDeviceCards haystack now includes all card.browsers names (all envs per device, not just best env).
- Seeding: postgres upsert preserves `active` (ENV_COLUMNS minus 'active' refreshed); never deletes rows; serviceFactory boot calls services.environments.seed(). Memory backend seed also preserves existing.active.
- Tests: npm test 832 pass/0 fail/9 skip; targeted server suites 82/82; public suites 100/100; test:acceptance RESULT: PASS. Test files updated to expanded matrix (7-browsers-on-Apple assertions, no-Safari-on-Android/Windows, list clamp 5000, picker search test).
- isCombinationSupported still rejects Safari on Android/Windows (verified live), accepts Firefox-on-iOS.
- UI diffs in tree (index/styles/app.js/acceptance) all belong to #14102/#14132/#14125 — none catalog-driven; only test adaptations reference #14151 (catalog render wait, search clear). No picker structure/sidebar/nav changes.

## WARNs
1. devicePicker.resolveDeviceEnvironment gained `executionLevel` param + runtimeAttestedLevel/executionLevelRequested filtering — undocumented in contract, likely other-ticket scope; behavior is additive.
2. Stale references to old field name `browserstackCapabilities` remain in comments + deviceRuntime/browserstackRuntimeProvider.js (runtime code paths read legacy env field — pre-existing, not introduced here).
3. environmentCatalog.test.js matrix-size assertion is a range (3000–5000), not exact 3650 — looser than contract.

## Test env note
test:acceptance requires QASE_TEST_PASSWORD (+ QASE_TEST_USER) env vars exported from .drytis/cred.json accounts[0]; it refuses to run otherwise (login throttle protection).
