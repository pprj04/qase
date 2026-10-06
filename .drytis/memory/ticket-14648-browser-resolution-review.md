# Review — #14648 (= #14632 NI01 Phase 2 browser resolution) re-review, 2027-10-05

**Verdict: PASS** (5 PASS, 1 FAIL on one sub-clause, 4 WARNs carried/updated). Suite 1199/0/20.

## Changes since round-1 review (same ticket number range)
- `catalogProviderRegistry.catalogProviderMeta()` now returns `browserSupport` (browserSupportReport, BS flag read from process.env per call) → round-1 WARN 2 partially addressed at code level. `/api/catalog/meta` route unchanged and STILL SHADOWED.
- `/api/environments/availability` Cache-Control reduced 300s→30s (round-1 WARN 3 mitigated).
- matrixService.js + matrixOrchestrator.js + matrixApi.js (#14633 checkpoint, ticket-relevant parts only): NOT_SUPPORTED/DDG items created honestly, orchestrator refuses execution, updateItem guards PASSED/FAILED behind sessionId.
- deviceBrowserMatrix.test.js now has NOT_SUPPORTED/engine_equivalent rendering tests (round-1 WARN 4 partially closed server-side; matrixColumns rendering still untested).

## FAIL (narrow, routing): `/api/catalog/meta` is dead in the running app
- `createCatalogRoutes` mounts `GET /api/catalog/:entity` at app.js:547 BEFORE the meta route at app.js:741 → 'meta' fails the ENTITIES whitelist → live authed curl returns **400 `QASE_CATALOG_UNKNOWN_ENTITY`**.
- `browserSupport` therefore never reaches the client via meta; the UI's "one source" is env-read browserSupport + /api/environments/availability (both live-verified). Route exists since #14275, predates this ticket — pre-existing shadow, but spec work item 2 remains unverifiable end-to-end.
- Code-level: catalogProviderMeta().browserSupport is correct (browserSupportReport over 7 browsers; no secrets).

## Criterion verdicts
1. DDG NOT SUPPORTED everywhere + can never PASS — **PASS**. Resolution table unconditional (even with BS flag → falls back to local NOT_SUPPORTED). resolveExecution gate FIRST → mode 'blocked' + browserSupport payload; browserBridge:546 throws RUNTIME_UNAVAILABLE pre-launch. matrixService.expandMatrixItems:136-138 records NOT_SUPPORTED with provider reason; orchestrator:88-90 marks NOT_SUPPORTED before execution; updateItem:334-337 forbids PASSED/FAILED without sessionId. Live: /api/environments?search=DuckDuckGo → not_supported + reason. Coverage: DDG can never produce a run (blocked at launch) → can never appear PASSED in /api/coverage (PASS_VERDICTS only from real run verdicts).
2. Truthful provider-derived availability — **PASS**. buildBrowserColumns available = !notSupported && active && board status; board statuses untouched; no REAL DEVICE · AVAILABLE fabricated (tester verified in-browser round).
3. Opera/Brave engine-equivalent — **PASS**. ENGINE_EQUIVALENT even with BS creds (BS not_supported → local wins, provider local-playwright); emulated path carries browserSupport; UI renders `VIRTUAL DEVICE · ENGINE-EQUIVALENT (CHROMIUM)` + reason tooltip.
4. Versions from provider capabilities, not hardcoded executability — **PASS**. BROWSER_VERSIONS ladders = inventory only; executability solely from resolveBrowserSupport (static provider-truth table: local Playwright baseline + BS upgrade-only). Nothing in ladders feeds executability.
5. BS creds re-resolution — **PASS**. environmentService:287-290 (withExecutionMetadata) and :657 (availability) + catalogProviderMeta:169-172 + matrixService envBrowserstackFlag:150-155 all read process.env per call, no cache. /api/catalog/refresh trivially re-resolves (verdicts computed, never stored). Availability cache 300s→30s (mitigation).
6. Security — **PASS**. No hardcoded creds/URLs (git grep over new files, only BROWSERSTACK_USERNAME/ACCESS_KEY env-var names). Coverage: 11 unit tests (7 browsers × 5 platforms + DDG catalog sweep 1,566 rows + resolveExecution DDG-block + opera/brave emulated) + endpoint tests (/api/environments/availability shape in environmentApi.test.js:160). Gap: no endpoint test hits DDG rows via HTTP asserting not_supported+reason (spec work item); no test covers catalogProviderMeta().browserSupport.

## WARNs
1. `/api/catalog/meta` route shadowing (root cause of the FAIL above) — pre-existing since #14275, not introduced here; fix is one-line (mount meta before :entity or whitelist 'meta').
2. matrixService/matrixOrchestrator have ZERO dedicated tests (no matrixService.test.js/matrixOrchestrator.test.js); DDG honest-state guarantees (expandMatrixItems/orchestrator gate/updateItem guard) are untested. Belongs to #14633, flag there.
3. Spec asks NOT SUPPORTED in "coverage UI" — /api/coverage has no browser-support dimension (needs runs to exist; DDG can never run → structurally can't show PASSED, so criterion holds negatively, but no explicit NOT SUPPORTED marker in coverage rows). No coverage UI file in public/ at all (data endpoint only).
4. Uncommitted on NIHARIKA — publish before redeploy (carried from every prior review; origin/DEV = f04f78d, predates all this work).
