# Review — Ticket #14166 catalog deepening (2026.10.2), NIHARIKA dirty worktree

Verdict: PASS with 2 WARNs, 1 FAIL (acceptance suite T8 timing flake, ticket-scoped).

## Contract verification (all evidenced)
- environmentCatalog.js: 4 new mac() devices HIGH-SIERRA/MOJAVE/CATALINA/BIG-SUR added to APPLE_DEVICES; BROWSER_VERSIONS deepened exactly as contracted (chrome 140–156 + legacy 138/139 exist as pre-existing operator envIds in live DB, firefox 141–158, edge 140–156, opera 122–137, brave 136–140, duckduckgo 1–3); MACOS_SAFARI_VERSIONS gains High Sierra 11.1.2/Mojave 12.1.2/Catalina 13.1.3/Big Sur 14.1.2 + Tahoe 26.2→26.4; safariVersionFor: exact match first, case-insensitive loop fallback; ENVIRONMENT_CATALOG_VERSION = '2026.10.2'. No availability-rule / other-device / envId-scheme changes.
- deviceCatalogSeed.js: MACOS_CHRONOLOGICAL extended with 4 legacy names for sort keys; device rows already derive from APPLE_DEVICES (map at lines 154/198).
- Capacity 5000→20000 (contract said 10000→20000 for seedBoard — actual app.js line 425 was 10000, now 20000): app.js validation 1..20000 (line 514), environmentService list clamp (370) + facets (492), postgres repo LIMIT clamp (308), public/app.js fetches limit=20000 (3 sites: 573, 4349, 4371).
- Matrix: node generateEnvironments() → 14617 envs, 14617 unique, idempotent (JSON-equal across runs). macOS Safari = 9 entries, one per macOS, Tahoe only 26.4.
- Live store (API, authed): active=16300, all=16301; ENV-MAC-TAHOE-SAF-26.2 row present with active:false (PATCH deactivation verified); TAHOE-SAF-26.4 active:true; active Tahoe Chrome = 19 (138–156 incl. operator-seeded legacy 138/139).
- Tests: npm test 832 pass / 0 fail / 9 skip (841 total); public suites 100/100; validate-matrix ALL CHECKS PASSED (live checks skipped w/o cookie — expected); test:ui PASS; test:acceptance — see FAIL below. environmentCatalog.test.js has Safari multi-word case-insensitive asserts, matrix 14000–16000, chrome deepEqual 140–156 list; catalogApi/deviceCatalog tests retargeted 154→160; environmentService 153→160; postgres repo catalogVersion 2026.10.2 + clamp 20000; environmentApi 20001→400 / 20000→200.

## FAIL (ticket-scoped): test:acceptance T8 flake
T8 ("browser change propagates") fails consistently (3+ runs) because `openPicker()` waits only `waitForTimeout(600)` after clicking Change; with 16300 active envs (limit=20000 fetch) the picker's card list renders at ~900ms, so the `.dp-select` browser dropdown is absent at the check. NOT an app bug: my Playwright probe shows the browser `<select aria-label="Browser for …">` appears at ~980ms and works. Later tests in the same script already use `waitForSelector('#dp-cards .dp-card', { timeout: 10000 })`. Patching line 75 from the 600ms sleep to that waitForSelector made the whole suite RESULT: PASS (verified, then reverted — reviewer does not fix). T16b failed once with header/stage "iPad" — same family of race (700ms sleep in pickDeviceCard); needs same treatment.

## WARNs
1. UI files DO differ from HEAD (index.html/styles.css/app.js) but all hunks belong to #14102/#14132 (choose-device strip/quick-actions/env-card removal, composer, LIVE DEVICE VIEW header) — same dirty tree as #14151 review; none are #14166-driven. styles.css cache-bust v=20261001-1 is #14102-era.
2. Chrome option-count discrepancy: tester observed 19 Chrome options on macOS Tahoe (138–156); generated catalog is 17 (140–156). The extra 138/139 come from legacy operator-seeded envIds in the live DB (active rows beyond generateEnvironments()). Contract said "legacy 138/139 kept as existing envIds" — consistent, but means picker counts will exceed generated counts for Chrome on modern devices. Ticket's "17 options" expectation matches generated; UI shows 19.
3. environmentCatalog.js header-comment block still documents 2026.10.1 availability rules (updated in #14151) — comment-version drift only, no behavior impact.

## Security spot-check
- PATCH /api/environments/:envId requires auth + double-submit CSRF (header vs cookie token) for non-GET; inputs validated; no SQLi (repo uses parameterized LIMIT/offset — test asserts params).
- No secrets in diff. Login throttle 40/min/IP + 10/15min/account burned my curl attempts (429) — acceptance script refuses to run without QASE_TEST_PASSWORD exported from cred.json accounts[0].

## Ops note
Active env count 16300 > "14617 generated" because the live store also carries operator-created envs (Chrome 138/139 etc.) and the deactivated 26.2 row (16301 total). Do not "clean" these — they are the intended legacy data.
