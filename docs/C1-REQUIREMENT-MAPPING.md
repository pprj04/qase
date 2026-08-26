# C1 Phase 1 — Requirement Mapping

"Usage, user statistics, traffic, and activity across our projects" — mapped honestly against
verified Phase 0 data. **Not assuming** "traffic" = HTTP traffic or "user statistics" =
authenticated QASE users.

| # | Dev-agent requirement (interpretation) | Existing endpoint(s) | Available fields | Missing | Derivable? | Telemetry needed? | New endpoint? |
|---|---|---|---|---|---|---|---|
| R1 | Which projects exist / project registry | GET /api/v2/projects | id, name, created_at, description | – | – | No | **No** |
| R2 | How much QA activity per project | GET /api/v2/missions?project_id= (total), /findings?project_id= (total), /test-cases, /regression/runs, /fix-validations | totals per collection | – | – | No | **No** |
| R3 | Activity over time (missions/findings/validations per day) | /missions, /findings, /fix-validations all support from/to + created_at | created_at per record | time-bucketed aggregate | Yes, but requires paging ALL records in window (7d = 1,625 missions = 4 pages × 280 KB) and client-side bucketing — wasteful but possible | No | **Yes — G2** /api/v2/usage/summary |
| R4 | Where usage comes from (channel mix) | /missions (source=api\|integration\|ui), /findings | source field | aggregate counts | Yes (same paging cost as R3) | No | Covered by G2 |
| R5 | Outcome quality of activity | /missions (status, verdict, quality_score), /findings/stats, /fix-validations (fix_status + metrics), /metrics/dashboard | full | – | – | No | **No** |
| R6 | Regression/monitoring activity | /regression/runs (+ from/to), /regression/trend, /schedules/:id/runs | full | – | – | No | **No** |
| R7 | Traffic **on QASE's API itself** (how much the agent / others call us) | **NOTHING** | – | request counts per endpoint/day | No — no store contains request data | **Yes — G3** | **Yes** /api/v2/metrics/api-usage |
| R8 | Traffic **on the target applications** QASE tests (drytis.com etc.) | **NOTHING** | – | page views, logins, sessions of target users | No — QASE observes target apps only during missions (browser automation), never passively | Would need product decision (out of scope) | **No — UNRESOLVED** |
| R9 | User statistics = **QASE operators** (who uses QASE) | **NOTHING** | – | per-user counts | No — single-tenant: one static Bearer token, no user/actor fields on any record (verified) | Would need auth redesign (out of scope) | **No — UNRESOLVED** |
| R10 | User statistics = **distinct apps/origins being tested** | /missions (target_url), /knowledge | target_url per mission | – | Yes | No | **No** |
| R11 | Real-time activity / live status | /api/v2/mission-status/:id, /sessions/:id (live), /api/v2/health | status fields | – | – | No | **No** |
| R12 | Bug taxonomy / classification vocabulary for mapping findings to dev workflows | /api/v2/bug-taxonomy | 9 enum sets | – | – | No | **No** |

## Decisions

1. **G2 /api/v2/usage/summary** — one aggregate endpoint answering R3+R4 (activity over time
   + channel mix) with server-side bucketing: `day` or `hour` buckets, `from`/`to` window,
   optional project_id. Strictly derived from existing stores; zero fabrication.

2. **G3 request-counter telemetry** — the only place "traffic" is real and ownable: QASE's
   own API. Bounded counter middleware on `/api/v2/*` (+ `/api/health`), persisted to
   `.qase/api-usage.json`, exposed via `/api/v2/metrics/api-usage`. Honest limit: counts
   since first deployment only — no backfill of historical requests (impossible).

3. **R8, R9 explicitly UNRESOLVED** — marked, not invented. Presented to the user in the
   final report; no endpoint fabricates either.

4. **No duplicates** — usage/summary reuses the same `listMissions/listFindings/…` accessors
   the other endpoints use; no second data path.
