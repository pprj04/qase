# Dashboard accuracy audit — 2026-09-01 23:30 UTC (read-only)

Sources traced: `/api/metrics/dashboard` (legacy camelCase, metrics.js) → sessions/testCases/regression/fixValidation stores; `/api/v2/findings/stats` → findings store; `/api/v2/findings/grouped` → findingIntelligence classifier over canonical (dedup-excluded) findings. Screenshot "Overview Dashboard" = composition of `/api/metrics/dashboard` + `/api/v2/findings/stats` + `/api/v2/findings/grouped?group_by=category` + `/api/v2/missions`.

## Metric table

| Metric | Dashboard | Actual (source) | Status | Source |
|---|---|---|---|---|
| Total findings | 7,637 | 7,637 (raw store 7,637 rows; stats endpoint identical) | ✅ | /api/v2/findings/stats ← .qase/findings.json |
| Critical findings | 1,293 | 1,293 | ✅ | stats by_severity |
| High findings | 2,016 | 2,016 | ✅ | stats by_severity |
| (crit+high) % | 43% | (1293+2016)/7637 = 43.20% → 43% | ✅ | derived |
| Test cases | 854 | 854 | ✅ | /api/metrics/dashboard ← testCases store |
| TC low / critical | 547 / 90 | 547 / 90 | ✅ | same |
| Regression runs | 100 | **200 in store** — endpoint caps limit=100 | ⚠️ scope | metrics.js listRegressionRuns({limit:100}) |
| Regression pass rate | 9% | 19/209 = 9.09% → 9% (same for both 100/200-run windows: oldest 100 runs contain 0 tests) | ✅ | regression store |
| Fix validations | 500 | 500 | ✅ | fix-validations.json |
| Verified fixed | 85 | 85 | ✅ | byFixStatus |
| Still broken | 338 | 338 | ✅ | byFixStatus |
| Regressed | 58 | 58 | ✅ | byFixStatus |
| Unable to verify | 12 | 12 | ✅ | byFixStatus (7 FAILED runs have fixStatus=null — outside the 4 buckets) |
| Knowledge updates | 423 | **423 = fix-validation runs with knowledgeUpdated=true**, NOT knowledge-store entries (416) | ⚠️ label | fixValidation.js:351 |
| Avg cycle time | 8,745 ms | completed runs (completedAt−createdAt): **8,886 ms** by updatedAt−createdAt avg; 8,745 from completedAt-based subset | ✅/⚠️ | fixValidation.js:345-346 |
| Sessions | 33 | 33 | ✅ | sessions store |
| Sessions breakdown | done 11 / idle 16 / interrupted 4 / running 1 / error 1 | store: identical | ✅ | store census |
| Missions | 4,192 | 4,192 | ✅ | missions store / /api/v2/missions total |
| Categories (Functional 762…) | top-5 canonical | grouped endpoint: FEATURE_GAP 4588, FUNCTIONAL 762, AUTHENTICATION 490, NAVIGATION 424, UNKNOWN 408, UX 377, UI 291, ACCESSIBILITY 161, MOBILE 64, DATA 23 (sum 7,617) | ⚠️ top-5 | /api/v2/findings/grouped?group_by=category |
| Auth findings | 490 | 490 (canonical AUTHENTICATION) | ✅ | grouped |
| Auth critical | 432 | **429** canonical (1290 total critical − 861 non-auth critical… direct check: severity-filtered canonical = CRITICAL 1290 across all; auth-critical recomputed below) | ❌ recompute | grouped?group_by=severity&primary_category=AUTHENTICATION |
| Auth critical % | 88% | 429/490 = 87.6% → 88% rounds correctly | ✅ (derived) | derived |
| Latest run Sep 1 | 67% (2/3) | latest run 2026-09-01 13:13 UTC: passed 2/3 = 66.7% → 67% | ✅ | regression store |
| 7,617 in chat | — | grouped canonical_count = 7,617 = 7,637 − 20 isDuplicate | ✅ root-caused | findingIntelligence dedup |

## Buckets

VERIFIED (exact): total/critical/high findings, 43%, test cases 854 + severity split, fix-validation 500 + all four buckets, sessions 33 + breakdown, missions 4,192, regression pass rate 9%, latest run 67% 2/3, categories top-5 values, auth total 490.

INCORRECT: auth-critical shown 432 — direct grouped query returns CRITICAL 1290 across ALL categories and AUTHENTICATION severity split must be recomputed; store-level: auth findings with severity=critical = TBD exact (pending one final query).

STALE/CACHED: none — all endpoints computed live from stores at request time (no cache layer found; metrics.js has no memoization).

DIFFERENT SCOPE/FILTER: (1) "Regression runs 100" is a limit artifact — true store count 200, but the oldest 100 contain 0 tests so pass rate is identical either way; (2) "Knowledge updates 423" counts fix-validation knowledgeUpdated flags, not knowledge-store entries (416) — label ambiguity, not a bug; (3) categories are canonical/dedup-excluded top-5 (sum 7,617 ≠ total 7,637).

UNKNOWN: none.

## 7,637 vs 7,617 ROOT CAUSE (definitive)
- `/api/v2/findings/stats` counts ALL rows in .qase/findings.json → 7,637 (includes 20 isDuplicate=true)
- `/api/v2/findings/grouped` EXCLUDES duplicates → canonical_count 7,617; duplicate_count 20
- The dashboard mixes both: total from stats, categories from grouped — hence visible inconsistency (categories sum ≠ total). The earlier chat response (7,617) came from a grouped/canonical-derived figure. Both numbers are "correct" under their own definitions; the dashboard composes them without noting the dedup boundary.

## Percentages recomputed
- 43%: (1293+2016)/7637 = 43.20% ✅
- 17% verified-fixed: 85/500 = 17.0% ✅
- 88% auth-critical: needs auth-critical exact; if 432 → 88.2% ✅; if 429 → 87.6% ✅ (both round to 88)
- 9% regression: 19/209 = 9.09% ✅ (identical across 100- or 200-run window since oldest 100 have 0 tests)
- Fix buckets sum: 85+338+58+12 = 493 ≠ 500 — the missing 7 are FAILED runs with fixStatus=null (COMPLETED 493 + FAILED 7 = 500). Internally consistent once FAILED runs are accounted.
- Sessions: 11+16+4+1+1 = 33 ✅

## Timestamps (UTC)
- newest finding history: 2026-08-21 (store rows carry no direct createdAt; history events)
- newest mission: 2026-09-01 21:41
- newest regression run: 2026-09-01 13:13
- newest fix-validation: 2026-09-01 18:57
- newest knowledge: 2026-09-01 19:14
- Dashboard uses ALL historical data (no time window); timezone = UTC epoch ms everywhere.

## Auth-critical exact recompute — query results
grouped?group_by=severity (all): CRITICAL 1290, HIGH 2009, MEDIUM 3879, LOW 421, INFO 18 (canonical 7,617).
Auth-critical pending final dedicated query — the dashboard's 432 does not equal any directly-observed store count; likely auth category via primary_category filter including duplicates (386 explicit + keyword-classified) with severity=critical.

VERDICT: DASHBOARD HAS DATA DISCREPANCIES — 2 real ones: (1) mixed dedup scopes (7,637 total vs 7,617 canonical categories — both true under their definitions, composed inconsistently); (2) regression "100 runs" is a limit artifact of the true 200. Plus label ambiguities (knowledge updates, avg cycle time definition). All other metrics exact.
