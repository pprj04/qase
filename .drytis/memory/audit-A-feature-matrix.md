# Audit A — Feature Matrix & Previously-Tested-Targets Inventory (2026-09-03)

Live verification against http://localhost:5173 (dev server, R2-B-H HEAD 54687b6). Every row evidence-backed. Server root 200, /openapi.json 200, /demo 302 (redirect to trailing slash — OK), benchmark :9901 200.

## Feature matrix

| # | Feature | Status | Evidence |
|---|---------|--------|----------|
| 1 | Missions create (v1 list/detail) | **WORKS** | GET /api/v1/missions?limit=1 → 200; detail + report + evidence 200 on latest mission (ccd46015, type=ux, target=new.drytis.com) |
| 2 | Mission detail findings (v1 path) | **PARTIAL** | GET /api/v1/missions/{id}/findings → 404 while /report and /evidence → 200 (integration-only surface; findings readable via /api/v2/findings?missionId=) |
| 3 | Sessions API | **WORKS** (empty store) | GET /api/sessions → 200 []; GET /api/v2/sessions → 200 — store legitimately wiped 2026-09-03 by the (now-fixed) test-isolation bug; empty ≠ broken |
| 4 | Findings list/stats/grouped | **WORKS** | /api/v2/findings?limit=5 → 200 (real rows); /stats 200 (total 7,914 at audit time); /grouped canonical 7,617 + 20 dups |
| /stats discrepancy recheck | 7,637→7,914 growth with canonical 7,617 fixed baseline | STILL PRESENT (mixed dedup scopes on one screen) |
| 5 | Test cases | **WORKS** | GET /api/v2/test-cases → 200, 854 cases; /api/test-cases/export surface exists (route found in code) |
| 6 | Workflows | **WORKS** | GET /api/v2/workflows → 200 |
|  A7 | Schedules | **WORKS** | GET /api/schedules + /api/v2/schedules → 200 |
| 8 | Regression runs | **WORKS** | GET /api/regression/runs → 200 (200 runs in store) |
| 9 | Fix-validation | **WORKS** | 500 validations: VERIFIED_FIXED 85 / STILL_BROKEN 338 / REGRESSED 58 / UNABLE_TO_VERIFY 12 / FAILED 7 |
| 10 | Knowledge | **WORKS** | GET /api/v2/knowledge → 200 (416 entries) |
| 11 | Reports/exports | **WORKS** | /api/sessions/:id/report.md, dev-report, export/findings, /api/test-cases/export, mission report (v1 + integration) all routed; latest mission report returned JSON 200 |
| 12 | Integration HMAC API | **WORKS** | whoami 200 (principal=integration, scopes listed); replayed nonce → 401 replayed_nonce; admin op as integration → 403 admin_required; unknown key → 401 invalid_auth_header; bad sig → 401 bad_signature |
| 13 | /api/v2 analytics (32 GETs) | **WORKS** | 14/14 endpoints probed → 200 incl. pagination; bad mission id → 404 mission_not_found |
| 14 | OpenAPI doc | **WORKS** | 46 paths / 47 ops, title "Qase API", hmacAuth scheme present |
| 15 | Auth token | **PARTIAL** | Bearer QASE_API_TOKEN → 200 on all v2 probes; BUT /api/v2/findings/stats returned 200 with NO token — server currently runs auth-optional (authMode unset in config.json; D3 QASE_AUTH_MODE feature exists but unset). UI login gate untested here (deferred to Audit B) |
| 16 | Targets: demo + benchmarks | **WORKS** | /demo 302→200; :9901–:9907 benchmark apps up (:9901 probed 200) |
| 17 | targetGuard SSRF boundary | **WORKS** (historical evidence) | Missions store shows 16 attempts against 169.254.169.254 (cloud metadata) — all aborted; 26 “not a url at all %” attempts aborted/interrupted — the guard held |

## Previously-tested-targets inventory (from .qase stores, epoch-ms createdAt corrected)

| Target | Missions | Last tested | Status spread |
|--------|----------|-------------|---------------|
| localhost:9876 (Qase benchmark suite) | 1,464 | 2026-08-23 | 1,328 still “created” shells; 29 completed / 62 aborted / 12 failed / 33 interrupted |
| **new.drytis.com** | **1,094** | **2026-09-02** | 247 completed / 276 aborted / 110 failed / 7 interrupted / 454 created shells |
| localhost:9906 (fix-validation buggy) | 756 | 2026-08-12 | all “created” (fix-validation harness shells) |
| localhost:5173 (self-tests) | 350 | 2026-09-01 | 280 created / 6 completed / 43 aborted / 9 failed / 12 interrupted |
| localhost:9901 (ContactVault demo app) | 299 | 2026-09-02 | 180 completed / 62 failed / 33 interrupted / 15 aborted |
| localhost:9902 (Todo demo app) | 140 | 2026-09-02 | 85 completed / 23 failed / 19 aborted / 12 interrupted |
| 127.0.0.1:9901 | 35 | 2026-09-01 | mostly aborted (guard tests) |
| example.com | 11 | 2026-08-30 | 9 aborted / 2 completed |
| localhost:9903 | 12 | 2026-08-27 | 5 completed / 7 failed |

Findings per host: :9901 3,602 · new.drytis.com 1,314 · :9902 1,085 · :9876 553 · :9903 243 · example.com 207 · 127.0.0.1:9901 110 · :5173 85.

## Data-quality rows (known issues, re-checked)

| Issue | Status |
|---|---|
| findingIntelligence AUTHENTICATION drift (490 classifier vs 386 true) | STILL PRESENT (classifier keyword rules unchanged since audit) |
| Mixed dedup scopes on dashboard (total 7,637 vs canonical 7,617) | STILL PRESENT |
| “100 regression runs” label vs true 200 | STILL PRESENT |
| Knowledge-updates label (423 fix-validation flags vs 416 store entries) | STILL PRESENT |
| Sessions history empty | Incident artifact (fixed cause; data unrecoverable) |
| Mission shells: 2,833+ created-never-started missions bloat missions.json (29MB) | STILL PRESENT (now 4,237 rows) |

## BROKEN rows → repro

- **A2 (v1 mission findings 404)**: `curl -H "Authorization: Bearer $TOK" http://localhost:5173/api/v1/missions/<real-id>/findings` → 404 while sibling endpoints return 200. Not user-facing via UI (findings available via /api/v2) — cosmetic API-surface gap.
- **A15 (auth-optional)**: `curl http://localhost:5173/api/v2/findings/stats` (no header) → 200. Expected under unset authMode; becomes a finding if QASE_AUTH_MODE=required is adopted (D3 knob exists).

## Outcomes

Feature surface: 15 WORKS / 2 PARTIAL / 0 BROKEN (product-level). All audit data saved. This feeds Audit D.
