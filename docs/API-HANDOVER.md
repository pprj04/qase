# QASE — API Handover (Dev Team / Pulse)

Status: **complete and live** — the Dev Team already consumes this successfully. Do not redesign. Verified 2026-08-29.

## The document

- **Local/preview:** `https://pulse-review-workspa-6grhjr.drytis.dev/openapi.json` → HTTP 200, `application/json; charset=utf-8`
- **Production:** `https://qase.drytis.com/openapi.json` → HTTP 200, `application/json` (currently serving the **C2** build; preview serves C3 — path set and operationIds are identical)
- OpenAPI **3.1.0**, generated live by `server/openapiDocument.js` (single source of truth — never hand-edited)
- `servers[0].url`: derived from request Host, overridable by env `QASE_PUBLIC_URL`. ⚠ Production currently advertises an internal host — set the prod `QASE_PUBLIC_URL` override when convenient (config-only).

## Surface summary

- **32 GET operations, 32 unique snake_case operationIds** (all ≤64 chars). **Zero write operations** are callable through this surface.
- **Auth:** `bearerAuth` — `Authorization: Bearer <token>` (long-lived instance token). `GET /api/v2/health` and `/openapi.json` are public.
- **Collections** answer `{ data, total, page, page_size }` when paged (defaults page=1, page_size=100, **clamped to 500**); ISO-8601 UTC timestamps; snake_case fields.

## Operation inventory (by tag)

| Tag | operationId | Route (under /api/v2 unless noted) | Purpose |
|---|---|---|---|
| Meta | health | /health | liveness (public) |
| Meta | get_bug_taxonomy | /bug-taxonomy | closed value sets (categories, severities…) |
| Projects | list_projects | /projects | all projects (bare array; single-tenant bounded) |
| Missions | list_missions | /missions | filter by status/type/source/project/date |
| Missions | get_mission | /missions/{id} | full mission record |
| Missions | list_mission_summaries | /mission-summaries | summaries + queue depth + governor stats |
| Missions | get_mission_status | /mission-status/{id} | lightweight status + quality (lazy-finalizing) |
| Sessions | list_sessions | /sessions | filter by project/date |
| Sessions | get_session | /sessions/{id} | session summary (heavy arrays only with `full=1`) |
| Findings | list_findings | /findings | filters: severity, status, lifecycle, review, mission… |
| Findings | get_finding | /findings/{id} | one finding |
| Findings | get_finding_stats | /findings/stats | counts by dimension |
| Findings | get_findings_grouped | /findings/grouped | grouped by dimension |
| TestCases | list_test_cases | /test-cases | filters incl. workflow/suite/tag |
| TestCases | get_test_case | /test-cases/{id} | one case (baseline-annotated) |
| TestCases | list_test_case_tags | /test-cases/tags | distinct tags |
| Workflows | list_workflows | /workflows | saved workflows |
| Workflows | get_workflow | /workflows/{id} | workflow + steps |
| Suites | list_suites | /suites | suite tree (bounded) |
| Schedules | list_schedules | /schedules | schedules + next/last run |
| Schedules | list_schedule_runs | /schedules/{id}/runs | runs of one schedule |
| Regression | list_regression_runs | /regression/runs | filter by project/schedule/target/date |
| Regression | get_regression_run | /regression/runs/{id} | run detail incl. per-test results |
| Regression | get_regression_trend | /regression/trend | chronological pass-rate trend |
| FixValidation | list_fix_validations | /fix-validations | validation runs + metrics |
| FixValidation | get_finding_validation | /findings/{id}/validation | validation history for a finding |
| Knowledge | list_knowledge_patterns | /knowledge | learned patterns + stats |
| Knowledge | get_knowledge_pattern | /knowledge/{id} | pattern + provenance |
| Metrics | get_dashboard_metrics | /metrics/dashboard | cross-entity aggregates |
| Metrics | get_ux_metrics | /metrics/ux | UX assessment counters |
| Usage | get_usage_summary | /usage/summary | time-bucketed QA activity |
| Usage | get_api_usage | /metrics/api-usage | authenticated /api/v2 request counts |

## How it fits together

```
Client (Pulse) → GET /openapi.json (public, re-read periodically)
              → tools = the 32 GETs above
              → GET /api/v2/* with Authorization: Bearer <token>
              → QASE projection layer (pulseProjection.js) over .qase/ stores
```

## Notes for consumers

- Collections that predate strict enveloping (`/projects`, `/regression/trend`) return legacy shapes; both remain stable and documented.
- `page_size` is clamped server-side to 500; invalid `from`/`to` dates answer 400.
- Anonymous calls to any `/api/v2` route except `/health` answer **401** with a JSON error envelope.
- A file snapshot + validator output live in `/workspace/QASE-API-HANDOFF/` (regenerated 2026-08-29 from the live endpoint; validator: **0 violations**).
- **Known gap:** the Bearer token is the instance's full read/write token — no read-only credential exists yet (decision pending; options A/B/C in `QASE-API-HANDOFF/README.md`).
