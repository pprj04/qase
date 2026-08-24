# M1-P2 — API ROUTE CLASSIFICATION (Phase 4 deliverable)

Source of truth: `.drytis/specs/m1-p1-product-contract.md` §4 (152 routes inventoried).
This document classifies every route into the M1-P2 disposition buckets. **No route was
removed** — deprecation candidates are documented only, and nothing is deleted until
proven dead + a release note exists.

## Disposition buckets

| Bucket | Meaning |
|---|---|
| **KEEP** | UI-used today, contract-tested in `tests-real/api-contract/` |
| **EXTERNAL CONTRACT** | Intended for outside consumers later — frozen shape, listed in the P1 contract |
| **INTERNAL** | Server-internal plumbing (webhooks, stores, watchdog sweeps) — may change freely |
| **TEST-ONLY** | Exists to serve the test/benchmark harness |
| **DEPRECATE (documented, not removed)** | Not UI-used, not externally consumed — candidates for removal in M1-P7 |

## Grouped classification (counts from the M1-P1 inventory)

| Domain (route prefix) | Total | KEEP (UI-used) | INTERNAL | TEST-ONLY | DEPRECATE candidates |
|---|---|---|---|---|---|
| `/api/sessions*` | 28 | 7 | 5 (SSE, watchdog, store sweeps) | 0 | 16 |
| `/api/v1/missions*` | 33 | 21 | 4 (missionBus/webhook emit) | 0 | 8 |
| `/api/v1/findings*`, `/api/findings*` | 33 | 17 | 2 | 0 | 14 |
| `/api/test-cases*` | 12 | 4 | 0 | 2 | 6 |
| `/api/workflows*` | 9 | 3 | 0 | 2 | 4 |
| `/api/schedules*` | 10 | 4 | 1 (cron sweep) | 1 | 4 |
| `/api/config*` | 5 | 5 | 0 | 0 | 0 |
| `/api/v1/fix-validations*` | 7 | 3 | 2 | 0 | 2 |
| `/api/v1/evidence*` | 5 | 2 | 1 | 0 | 2 |
| `/api/artifacts*` | 4 | 2 | 0 | 2 (phase9c artifact suite) | 0 |
| `/api/knowledge*` | 6 | 2 | 1 | 0 | 3 |
| `/api/health`, `/api/stats*`, misc | 9 | 3 | 2 | 4 | 0 |
| `/demo/*` pages (9) | 9 | 0 | 0 | 9 | 0 |
| **Total** | **170 incl. demo** | **73** | **18** | **20** | **59** |

Notes:
- The 59 DEPRECATE candidates are **orphans** (M1-P1 §4: 69 orphan routes total; 10 of
  those are internal plumbing already counted as INTERNAL). They stay in place until
  M1-P7 (OpenAPI) prunes them with a documented removal list.
- The phase18/phase16/phase17 API suites pin behavior of several INTERNAL routes;
  those cannot be reclassified without touching protected suites.

## What the contract suite actually freezes (tests-real/api-contract/contract-baseline.test.js)

- `/api/health` — 200 shape `{ status, uptime… }`
- `/api/sessions` — 200 list shape, auth behavior (documented single-tenant: open GET)
- `/api/v1/missions` POST — 202 + id validation; 4xx on bad device claim (truth suite covers)
- `/api/v1/missions/:id/report` — 200/404 shape
- `/api/findings*` — list shape + export routes include `/api` prefix (P0 export bug is FIXED)
- `/api/test-cases*`, `/api/workflows*`, `/api/schedules*` — 200 list shapes, create→delete round-trips
- `/api/config/*` — redacted config never leaks credential material
- `/api/v1/fix-validations*` — lifecycle states UNABLE_TO_VERIFY / STILL_BROKEN / VERIFIED_FIXED / REGRESSED derivations (unit-level via phase18 suites; HTTP shape pinned here)
- `/api/v1/evidence/*` — list/detail shapes
- `/api/artifacts/*` — serves files, path traversal rejected (S6 must stay blocked)

Every KEEP route above is asserted with: status code, required response fields, and
error shape (404/400) for the missing-id case where applicable.
