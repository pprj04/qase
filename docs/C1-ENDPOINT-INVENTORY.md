# C1 Phase 0 — Endpoint Inventory (verified live 2026-08-26)

All 30 endpoints under `/api/v2/*`. Auth: Bearer token via `requireApiToken` (timing-safe
Bearer / cookie / ?token=). Legacy `/api/*` routes untouched. Envelope for collections:
`{data, total, page, page_size}`, default page=1 / page_size=100 / hard max 500. Timestamps
ISO-8601 UTC. Correlation IDs on every response. `/openapi.json` documents all 30.

| # | Path | Auth | Response | Filters | Pagination | Source |
|---|------|------|----------|---------|------------|--------|
| 1 | GET /api/v2/health | Bearer (BUG: doc says public) | `{status,uptime,project}` | – | – | process |
| 2 | GET /api/v2/bug-taxonomy | Bearer | taxonomy enums | – | – | findingIntelligence constants |
| 3 | GET /api/v2/projects | Bearer | bare array (small, documented) | – | – | projects.json |
| 4 | GET /api/v2/missions | Bearer | envelope | project_id, status, type, source, from/to | yes | missions.json (3,479) |
| 5 | GET /api/v2/missions/:id | Bearer | object | – | – | missions.json |
| 6 | GET /api/v2/mission-summaries | Bearer | envelope | project_id, status, type, from/to | yes | missions.json |
| 7 | GET /api/v2/mission-status/:id | Bearer | object | – | – | missions.json |
| 8 | GET /api/v2/sessions | Bearer | envelope | project_id, from/to | yes | sessions.json (24) |
| 9 | GET /api/v2/sessions/:id | Bearer | object (with live state) | – | – | sessions.json |
| 10 | GET /api/v2/findings | Bearer | envelope | project_id, severity, status, category, assignee, session_id, primary_category, priority, finding_status, review_status, reproducibility, mission_id, q, from/to | yes | findings.json (5,469) |
| 11 | GET /api/v2/findings/stats | Bearer | counters | project_id | – | findings.json |
| 12 | GET /api/v2/findings/grouped | Bearer | groups | group_by (6 options) | – | findings.json |
| 13 | GET /api/v2/findings/:id | Bearer | object | – | – | findings.json |
| 14 | GET /api/v2/test-cases | Bearer | envelope | project_id, target_url, workflow_id, suite_id, tag, from/to | yes | test-cases.json (761) |
| 15 | GET /api/v2/test-cases/tags | Bearer | envelope | project_id | yes | test-cases.json |
| 16 | GET /api/v2/test-cases/:id | Bearer | object | – | – | test-cases.json |
| 17 | GET /api/v2/workflows | Bearer | envelope | project_id, target_url, from/to | yes | workflows.json |
| 18 | GET /api/v2/workflows/:id | Bearer | object with steps | – | – | workflows.json |
| 19 | GET /api/v2/suites | Bearer | envelope | project_id, from/to | yes | suites.json |
| 20 | GET /api/v2/schedules | Bearer | envelope | project_id, from/to | yes | schedules.json |
| 21 | GET /api/v2/schedules/:id/runs | Bearer | envelope | from/to | yes | regression-runs.json |
| 22 | GET /api/v2/regression/runs | Bearer | envelope | project_id, schedule_id, target_url, from/to | yes | regression-runs.json (200) |
| 23 | GET /api/v2/regression/runs/:id | Bearer | object | – | – | regression-runs.json |
| 24 | GET /api/v2/regression/trend | Bearer | array | project_id, schedule_id, target_url, limit (≤500) | – | regression-runs.json |
| 25 | GET /api/v2/fix-validations | Bearer | envelope + metrics | fix_status, from/to | yes | fix-validations.json (500) |
| 26 | GET /api/v2/findings/:id/validation | Bearer | latest+history+metrics | – | – | fix-validations.json |
| 27 | GET /api/v2/knowledge | Bearer | envelope + stats | from/to | yes | knowledge.json |
| 28 | GET /api/v2/knowledge/:id | Bearer | provenance | – | – | knowledge.json |
| 29 | GET /api/v2/metrics/dashboard | Bearer | aggregate | project_id | – | all stores |
| 30 | GET /api/v2/metrics/ux | Bearer | counters | – | – | uxAssessment counters |

## Data-shape facts

- **Mission `source` values**: `integration` (355/500), `api` (145/500) — i.e. *how the
  mission was created*, usable as "usage channel" signal.
- **Mission status**: created 218, completed 101, aborted 98, failed 69, interrupted 10, cancelled 4.
- **No user/actor fields** exist on any record — QASE is single-tenant, one Bearer credential.
- **7-day volume**: 1,625 missions / 3,688 findings (all in `Default` project; `AI studio` empty).
- **No request/traffic store exists** — nothing counts API calls today.

## Contract bugs found

1. `/api/v2/health` doc declares `public: true`; router auth-gates it. Test that claims to
   verify publicity sends the Bearer header (false positive).
