# QASE — Dev Team Usage/Traffic Agent API Discovery & Integration Audit

**Date:** 2026-08-26  
**Author:** QASE Engineering  
**Status:** DISCOVERY — awaiting Dev Team contract confirmation  
**Implementation:** NOT STARTED (per Phase 9 instructions)

---

## 1. Executive Summary

Management asked us to create API endpoints so the Dev Team's independent usage/traffic monitoring agent can consume QASE data. We do NOT have access to that agent — its source code, database, prompts, or implementation are unknown.

This report is a factual audit of what QASE currently stores, what it can expose, what it cannot expose, and what we must learn from the Dev Team before building anything.

**Key findings:**

- QASE has rich **QA-domain data** (3,479 missions, 5,460 findings, 200 regression runs, 24 sessions, 500 fix validations) but **no user, traffic, request, LLM-cost, or latency telemetry**.
- "Usage" and "traffic" as the Dev Team likely means them **cannot be answered from existing data** — QASE does not track API request counts, unique users, active users, token consumption, or HTTP latency.
- What QASE *can* expose: **project-scoped QA activity** (missions run, findings found, tests executed, regression runs, fix validations) with timestamps and aggregations.
- 7 candidate endpoints are proposed; only **2 are READY** today, 2 are PARTIALLY READY, and 3 REQUIRE TELEMETRY or Dev Team confirmation before they can be built.
- The existing Pulse OpenAPI integration (`/openapi.json` → `/api/v2/*`) is the correct delivery mechanism — new endpoints should follow the same pattern.

**Recommendation:** Do NOT build endpoints yet. Send the Dev Team the 25 questions in §15 and the top-10 list in the summary. Build only after receiving answers.

---

## 2. What Management Requested

> "Create endpoints so the Dev Team's agent can consume QASE data."

The Dev Team has a separate, independent agent that tracks user statistics, usage, traffic, and activity across all Drytis projects. We are to make QASE's data consumable by that agent. We do not know what the agent needs — we must discover what QASE has, propose what we can expose, and ask the Dev Team what they actually want before implementing.

---

## 3. What We Know

| Fact | Evidence |
|---|---|
| QASE is an autonomous QA agent platform | server/index.js, Express 5, port 5173 |
| All data is file-based JSON storage under `.qase/` | 20 JSON stores, ~85 MB total (excluding corrupted artifact dirs) |
| Two API surfaces exist | Legacy `/api/*` (requireApiToken) + Pulse `/api/v2/*` (requireApiToken) + Integration `/api/v1/integration/*` (HMAC) |
| OpenAPI 3.1 document is live at `/openapi.json` | 30 GET operations, 59 KB, served via `buildOpenApiDocument()` |
| Auth is Bearer token (long-lived, read-only capable) | `requireApiToken` middleware, `QASE_API_TOKEN` env |
| Projects are the primary scoping dimension | 2 projects currently (Default, AI studio) |
| Workspaces exist as an attribute on integrations/projects/missions, not as a standalone store | `server/integrationAuth.js`, `server/projects.js` |
| Missions, findings, test cases, regression runs, fix validations, UX assessments, knowledge patterns all have timestamps and project IDs | See §5 |
| The existing data spans 2026-08-11 through 2026-08-26 (15 days of activity) | Missions daily breakdown |

---

## 4. What We Do NOT Know

| Unknown | Impact |
|---|---|
| What "usage" means to the Dev Team's agent | Could mean API calls, session counts, mission counts, or something else |
| What "traffic" means to the Dev Team's agent | Could mean HTTP requests, agent executions, webhook deliveries, or something else |
| What "active user" means | QASE has no users — does the Dev Team mean active projects? Active sessions? |
| What "active project" means | Has missions in the last 7 days? Has findings? Has sessions? |
| Whether the agent needs raw events or aggregated counts | Determines whether we expose list endpoints or summary endpoints |
| What time granularity is needed | Daily? Hourly? Per-mission? |
| Whether the agent needs user-level data | QASE has no users — this would require a new concept |
| Whether the agent needs LLM/token/cost data | QASE does not track this — would require new telemetry |
| What polling frequency the agent will use | Determines caching needs |
| What field names/schema the agent expects | Determines response shape |
| Whether the agent supports Bearer auth or needs something else | QASE currently supports Bearer |
| Whether the agent needs workspace-level scoping | QASE has workspaces as an attribute, not a queryable store |

---

## 5. Current QASE Data Sources

### Storage Architecture

All data is stored as JSON files under `/workspace/.qase/`. Each store uses an in-memory data structure (Map or array) that is periodically flushed to disk via `atomicWrite` (debounced 250–500ms). There is no database (no MySQL usage, no SQLite, no Redis).

### Complete Data Source Inventory

| # | Data Source | File | Storage | Size | Records | Retention | Historical? | Has Timestamps? | Has Project ID? |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Projects | `server/projects.js` | `.qase/projects.json` | 308 B | 2 | Unbounded | ✅ | ✅ `createdAt`, `updatedAt` | — (IS the project) |
| 2 | Sessions | `server/store.js` | `.qase/sessions.json` | 11.4 MB | 24 | **Bounded: 50 sessions / 12 MB** | ⚠️ Partial (50 max) | ✅ `createdAt`, `updatedAt` | ✅ |
| 3 | Missions | `server/missions.js` | `.qase/missions.json` | 18 MB | 3,479 | Unbounded | ✅ Full history | ✅ `createdAt`, `updatedAt`, `completedAt`, `startedAt`, `queuedAt` | ✅ |
| 4 | Findings | `server/findings.js` | `.qase/findings.json` | 11.4 MB | 5,460 | Unbounded | ✅ Full history | ✅ `ts`, `createdAt` (epoch ms) | ✅ |
| 5 | Test Cases | `server/testCases.js` | `.qase/test-cases.json` | 613 KB | — | Unbounded | ⚠️ `lastRun` only | ✅ `createdAt`, `updatedAt`, `lastRun` | ✅ |
| 6 | Workflows | `server/workflows.js` | `.qase/workflows.json` | 1.4 MB | — | Unbounded | ⚠️ | ✅ `createdAt`, `updatedAt` | ✅ |
| 7 | Schedules | `server/scheduler.js` | `.qase/schedules.json` | 1.3 KB | 3 | Unbounded | ⚠️ `lastRun` only | ✅ `lastRun.ts`, `nextRun`, `createdAt` | ✅ |
| 8 | Regression Runs | `server/regressionStore.js` | `.qase/regression-runs.json` | 297 KB | 200 | **Bounded: 200 runs** | ✅ 200 runs | ✅ `ts` | ✅ |
| 9 | Replay Runs | `server/replayStore.js` | `.qase/replay-runs.json` | 2.6 MB | — | **Bounded: 50/test case** | ✅ Per test | ✅ `ts` | ⚠️ via testCaseId |
| 10 | Fix Validations | `server/fixValidation.js` | `.qase/fix-validations.json` | 4.3 MB | ~500 | **Bounded: 500 runs** | ✅ 500 runs | ✅ `createdAt`, `updatedAt`, `completedAt` | ✅ |
| 11 | UX Assessments | `server/uxAssessment.js` | `.qase/ux-assessments.json` | 13.3 MB | — | Uncapped | ✅ | ✅ per-assessment | ✅ |
| 12 | Knowledge Patterns | `server/knowledge.js` | `.qase/knowledge.json` | 693 KB | — | **Bounded: 500 patterns** | ✅ 500 | ✅ `firstSeen`, `lastSeen` | ⚠️ via sourceMissions |
| 13 | Evidence Graph | `server/evidenceGraph.js` | `.qase/evidence-graph.json` | 33.7 MB | — | **Bounded: 60K+60K** | ✅ | ✅ per-item | ⚠️ via session/mission |
| 14 | Decision Traces | `server/decisionTraces.js` | `.qase/decision-traces.json` | 39 KB | — | **Bounded: 50×100** | ✅ | ✅ `ts` | ⚠️ via missionId |
| 15 | Integrations | `server/integrationAuth.js` | `.qase/integrations.json` | 1.3 KB | 7 | Unbounded | ✅ | ✅ `createdAt`, `lastUsedAt` | ⚠️ via workspaceId |
| 16 | Webhook Subscriptions | `server/webhookDelivery.js` | `.qase/webhook-subscriptions.json` | 7.1 KB | — | Unbounded | ✅ | ✅ `createdAt` | ✅ |
| 17 | Webhook Deliveries | `server/webhookDelivery.js` | `.qase/webhook-deliveries.json` | 1.9 MB | — | **Bounded: 2,000** | ✅ 2,000 | ✅ per-attempt | ✅ |
| 18 | Baselines | `server/baselines.js` | `.qase/baselines.json` | 516 B | 2 | Unbounded | ✅ | ✅ `ts` | ⚠️ via testCaseId |
| 19 | Suites | `server/suites.js` | `.qase/suites.json` | 2 B | 0 | Unbounded | — | — | ✅ |
| 20 | Config | `server/config.js` | `.qase/config.json` | 909 B | 1 | Overwritten on update | ❌ | — | — |

### Data Sources That Do NOT Exist

| # | Data Source | Status | Impact |
|---|---|---|---|
| A | **Users** | ❌ No user concept. `createdByUserId` exists on missions but is never populated (always `null`). No user store, no user accounts, no user profiles. | Cannot answer "how many users?", "who is using QASE?", or "active users" |
| B | **LLM/Token Usage** | ❌ QASE makes LLM calls via the CleanSlate SDK and direct OpenAI-compatible requests but does NOT log token counts, usage, or cost. The `usage` field in LLM responses is discarded. | Cannot answer "how many tokens consumed?", "what is the LLM cost?", or "credits used" |
| C | **Request/Traffic Log** | ❌ No request logging middleware. No access log. No request counter. Correlation IDs exist but are transient (not persisted in a request log). | Cannot answer "how many API requests?", "traffic volume", or "requests per endpoint" |
| D | **API Latency** | ❌ No HTTP response time tracking. Per-operation durations exist in individual stores (regression `durationMs`, fix validation `timings{}`, UX `durationMs`) but no unified latency tracking and no API-level latency. | Cannot answer "API response time", "latency", or "p99 latency" |
| E | **Error Log** | ❌ Errors are `console.error`'d and lost. No structured error store, no error aggregation. Individual records may contain error text (missions `failureReason`, fix validations `error`, regression results `error`). | Cannot answer "error rate", "errors per day", or "top error types" |
| F | **Global Audit Log** | ❌ No unified activity feed. Session activities are explicitly NOT an audit log (capped 500, pruned with sessions). Finding history and fix validation review trails are auditable for state changes only. | Cannot answer "what actions were taken?" across the system |
| G | **Bug Intel Metrics** | ⚠️ In-memory only — reset on restart. Not persisted. | Cannot provide historical enrichment/verification metrics |

---

## 6. Existing API Capabilities

### API Surface Map

| Surface | Mount Path | Auth | Purpose | Endpoints |
|---|---|---|---|---|
| Legacy API | `/api/*` | `requireApiToken` (Bearer) | Full read/write API for the QASE SPA + agent | ~105 GET + POST/PUT/DELETE |
| Pulse v2 API | `/api/v2/*` | `requireApiToken` (Bearer) | Read-only façade for external analytics agents | 30 GET |
| Integration API | `/api/v1/integration/*` | `requireIntegrationAuth` (HMAC) | Workspace-scoped external integration (mission create, webhook, findings) | ~15 GET + POST |

### Authentication

| Method | Mechanism | Token Source | Scoping |
|---|---|---|---|
| `requireApiToken` | Bearer header, `qase_token` cookie, or `?token=` query | `QASE_API_TOKEN` env or `.qase/config.json` | Global — no workspace/project enforcement |
| `requireIntegrationAuth` | HMAC-SHA256 signed request | `QASE_INTEGRATION_SECRET` env | Workspace-scoped (`workspaceId` on principal) |

**Critical for Dev Team:** `requireApiToken` is a **global read token** — it sees all projects, all workspaces. There is no per-project or per-workspace scoping on the Bearer auth path. The HMAC path has workspace scoping but is designed for mission creation, not analytics reads.

### Middleware Stack

```
Express → correlationIdMiddleware (X-Correlation-Id)
        → setAuthCookie (refresh only, no auto-grant)
        → body parsers, static, CORS
        → /api routes (requireApiToken)
        → /api/v2 routes (requireApiToken) — Pulse
        → /api/v1/integration/* (requireIntegrationAuth)
        → /openapi.json (public)
        → public/* (SPA static files)
```

### Correlation IDs

Every request gets a `X-Correlation-Id` (generated or validated from header). Propagated to missions, webhook deliveries, and response headers. Persisted on missions (`mission.correlationId`) but **not** in a queryable request log.

---

## 7. Existing OpenAPI Capabilities

| Check | Status | Detail |
|---|---|---|
| `/openapi.json` served | ✅ | 200, 59 KB, `application/json` |
| OpenAPI version | ✅ | 3.1.0 |
| Server URL declared | ✅ | `<public host>` (via `QASE_PUBLIC_URL` env) |
| Security scheme | ✅ | `bearerAuth` (HTTP Bearer) |
| GET operations | ✅ | 30, all with snake_case `operationId` ≤64 chars |
| Summaries | ✅ | Every GET has a one-line summary |
| Tags | ✅ | 13 tag groups (Projects, Missions, Sessions, Findings, TestCases, Workflows, Suites, Schedules, Regression, FixValidation, Knowledge, Metrics, Meta) |
| Response schemas | ✅ | Every GET has a response schema |
| Collections under `data` with `total` | ✅ | All collection endpoints use `{data, total, page, page_size}` |
| Pagination | ✅ | `page` (default 1) + `page_size` (default 100, max 500) on all collections |
| Enum filters | ✅ | 15 enum query params |
| Date ranges | ✅ | `from`/`to` on time-based collections (24 params across endpoints) |
| ISO 8601 timestamps | ✅ | All v2 endpoints return ISO 8601 UTC strings |
| Numbers as numbers | ✅ | No stringified numbers in v2 responses |
| Stable `id` + `project_name` | ✅ | `project_id` AND `project_name` on 9 schemas |
| `additionalProperties` for free-form | ✅ | 10 `additionalProperties` maps; no standalone `{"type":"null"}` |
| Read-only | ✅ | v2 router registers GET handlers only |

**Any new usage/traffic endpoints must follow this same pattern.**

---

## 8. Usage Metric Availability Matrix

| Metric | Exists? | Source | Accurate? | Historical? | Can API Expose? | Missing Data |
|---|---|---|---|---|---|---|
| Total projects | ✅ | `projects.json` | ✅ | ✅ (createdAt) | ✅ Easy | None |
| Active projects | ⚠️ Derivable | Missions/sessions by projectId | ✅ | ✅ | ✅ Need to define "active" | Definition of "active" |
| Total users | ❌ | — | — | — | ❌ | No user concept |
| Active users | ❌ | — | — | — | ❌ | No user concept |
| Project usage (missions/project) | ✅ | `missions.json` | ✅ | ✅ 15 days | ✅ Easy | None |
| User usage | ❌ | — | — | — | ❌ | No user concept |
| Sessions count | ✅ | `sessions.json` | ⚠️ Bounded (50 max) | ⚠️ 50 only | ✅ With caveat | Pruned sessions lost |
| Missions count | ✅ | `missions.json` | ✅ | ✅ Full history | ✅ Easy | None |
| Requests count | ❌ | — | — | — | ❌ | No request log |
| Traffic (HTTP) | ❌ | — | — | — | ❌ | No request log |
| API calls | ❌ | — | — | — | ❌ | No request log |
| Errors | ❌ | — | — | — | ❌ | No error log |
| Latency (API) | ❌ | — | — | — | ❌ | No latency tracking |
| AI/LLM usage | ❌ | — | — | — | ❌ | No token logging |
| Input tokens | ❌ | — | — | — | ❌ | Not tracked |
| Output tokens | ❌ | — | — | — | ❌ | Not tracked |
| Credits | ❌ | — | — | — | ❌ | No credit system |
| Execution time (missions) | ✅ | `missions.json` (`startedAt`, `completedAt`) | ⚠️ Partial | ✅ | ✅ Derivable from timestamps | Not stored as explicit duration |
| Execution time (regression) | ✅ | `regression-runs.json` (`durationMs`) | ✅ | ✅ 200 runs | ✅ Easy | Bounded to 200 runs |
| Execution time (fix validation) | ✅ | `fix-validations.json` (`timings{}`) | ✅ | ✅ 500 runs | ✅ Easy | Bounded to 500 runs |
| Daily usage | ⚠️ Derivable | Missions/sessions/findings by day | ✅ | ✅ 15 days | ✅ Need aggregation | No pre-computed daily summary |
| Weekly usage | ⚠️ Derivable | Same, grouped by week | ✅ | ✅ ~2 weeks | ✅ Need aggregation | No pre-computed weekly summary |
| Monthly usage | ⚠️ Derivable | Same, grouped by month | ⚠️ | ⚠️ ~0.5 month only | ✅ Need aggregation | Insufficient history for meaningful monthly |
| Activity (mission events) | ✅ | `missions.json` status transitions, timestamps | ✅ | ✅ | ✅ Via mission list + status filter | No event stream, only current state |
| Activity (session events) | ⚠️ | `sessions.json` activities[] | ⚠️ | ⚠️ Capped 500/session, pruned sessions | ⚠️ Partial | Not an audit log |
| Last active time (project) | ✅ Derivable | Max(updatedAt) across missions/sessions/findings per project | ✅ | ✅ | ✅ Need aggregation | Not pre-computed |
| Last active time (system) | ✅ Derivable | Max(updatedAt) across all stores | ✅ | ✅ | ✅ Easy | Not pre-computed |
| Findings per project | ✅ | `findings.json` by projectId | ✅ | ✅ | ✅ Already in v2 | None |
| Findings by severity | ✅ | `findings.json` by severity | ✅ | ✅ | ✅ Already in v2 | None |
| Regression pass rate | ✅ | `regression-runs.json` | ✅ | ✅ 200 runs | ✅ Already in v2 | None |
| Fix validation rate | ✅ | `fix-validations.json` | ✅ | ✅ 500 runs | ✅ Already in v2 | None |

---

## 9. Traffic Metric Availability Matrix

| Metric | Exists? | Source | Accurate? | Historical? | Can API Expose? | Missing Data |
|---|---|---|---|---|---|---|
| HTTP requests | ❌ | — | — | — | ❌ | No request log |
| Requests per endpoint | ❌ | — | — | — | ❌ | No request log |
| Requests per project | ❌ | — | — | — | ❌ | No request log |
| Requests per user | ❌ | — | — | — | ❌ | No users, no request log |
| Unique visitors | ❌ | — | — | — | ❌ | No user concept |
| API response time | ❌ | — | — | — | ❌ | No latency tracking |
| Error rate (HTTP) | ❌ | — | — | — | ❌ | No error log |
| Bandwidth | ❌ | — | — | — | ❌ | No traffic tracking |
| Webhook deliveries | ✅ | `webhook-deliveries.json` | ✅ | ✅ 2,000 records | ✅ Can expose | Bounded to 2,000 |
| Agent executions (missions run) | ✅ | `missions.json` | ✅ | ✅ 3,479 | ✅ Already in v2 | None |
| Test executions (regression runs) | ✅ | `regression-runs.json` | ✅ | ✅ 200 | ✅ Already in v2 | Bounded to 200 |
| Fix validation executions | ✅ | `fix-validations.json` | ✅ | ✅ 500 | ✅ Already in v2 | Bounded to 500 |
| Correlation ID lookup | ⚠️ | `missions.json` (correlationId field) | ✅ | ✅ | ✅ Mission-level only | Not a request log |

**Conclusion:** QASE has no HTTP traffic data. What it does have is **agent execution traffic** — missions run, tests executed, validations performed. If the Dev Team means "how much QA work is happening," we can answer. If they mean "HTTP request volume," we cannot.

---

## 10. Candidate Endpoint Matrix

Each endpoint is evaluated against: data source existence, readiness, and expected utility for the Dev Team's agent.

### READY — Can be built today with existing data

| # | Endpoint | Purpose | Source | Response Fields | Filters | Pagination | Date Ranges | Performance | Security |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `GET /api/v2/usage/overview` | System-wide summary: total projects, missions, findings, test cases, regression runs, fix validations, sessions, with breakdowns | All stores (aggregation) | `total_projects`, `total_missions`, `total_findings`, `total_test_cases`, `total_regression_runs`, `total_fix_validations`, `total_sessions`, `missions_by_status`, `findings_by_severity`, `regression_pass_rate`, `fix_validation_rate`, `first_activity_at`, `last_activity_at` | `project_id` (optional) | No (single object) | `from`/`to` (filter underlying data) | ⚠️ Loads all stores in memory; fast at current scale (<1s), but at 10K+ missions could take 2-5s | Bearer auth, read-only |
| 2 | `GET /api/v2/usage/projects` | Per-project usage summary: mission count, finding count, test case count, session count, regression pass rate, fix validation rate, last active time | All stores grouped by `projectId` | Array of `{project_id, project_name, mission_count, finding_count, test_case_count, session_count, regression_pass_rate, fix_validation_rate, last_active_at, created_at}` | `status` (enum: active/inactive) | ✅ `page`/`page_size` | `from`/`to` (activity filter) | ⚠️ Iterates all stores per project; fine at 2 projects, O(N×stores) at 1K projects | Bearer auth, read-only |

### PARTIALLY READY — Can be built but with caveats or limited data

| # | Endpoint | Purpose | Source | Caveat | Readiness |
|---|---|---|---|---|---|
| 3 | `GET /api/v2/usage/projects/{project_id}` | Single project deep-dive: mission timeline, finding breakdown, regression trend, fix validation history, session count | All stores filtered by `projectId` | Dashboard metrics endpoint already exists at `/api/v2/metrics/dashboard?project_id=X` but uses in-memory counters for some metrics | PARTIALLY READY — existing dashboard endpoint covers most of this; may need wrapping |
| 4 | `GET /api/v2/usage/timeseries` | Time-series of QA activity (missions created, findings found, tests run, validations completed) bucketed by day/week | `missions.json`, `findings.json`, `regression-runs.json`, `fix-validations.json` | Must iterate all records and bucket by timestamp. Only 15 days of history. Must define bucket size. | PARTIALLY READY — needs aggregation logic + bucket size decision |

### REQUIRES TELEMETRY — Cannot be built without new instrumentation

| # | Endpoint | Purpose | What's Missing | Readiness |
|---|---|---|---|---|
| 5 | `GET /api/v2/usage/users` | User-level usage: who is using QASE, per-user activity, last seen | **No user concept.** No user store, no user accounts, no `userId` populated on any record. Would need to add user tracking to QASE. | REQUIRES TELEMETRY |
| 6 | `GET /api/v2/usage/traffic` | HTTP request volume, requests per endpoint, response times, error rates | **No request log.** No middleware tracks request count, latency, or errors. Would need request logging middleware + persistence. | REQUIRES TELEMETRY |
| 7 | `GET /api/v2/usage/llm` | LLM token consumption, cost, model usage, call counts | **No LLM usage tracking.** LLM calls are made but `usage` field is discarded. Would need to intercept and log LLM response usage. | REQUIRES TELEMETRY |

### REQUIRES DEV TEAM CONFIRMATION

| # | Endpoint | Why Confirmation Is Needed |
|---|---|
| All 7 | We do not know which of these the Dev Team's agent actually needs. Building all 7 would waste effort on endpoints the agent never calls. |

---

## 11. Missing Telemetry

To support the endpoints marked REQUIRES TELEMETRY, the following would need to be built:

### 11.1 User Tracking

**What:** A user concept with identity, association to sessions/missions, and last-active tracking.

**Changes required:**
- New `users.json` store or add `userId`/`userName` to existing records
- Auth middleware that identifies the caller (currently Bearer token is anonymous — no user identity)
- `createdByUserId` on missions is already defined but never populated — would need to populate it from auth context

**Effort:** Medium — touches auth, all store writers, API surface.

**Risk:** Changes auth model; could break existing integrations.

### 11.2 Request/Traffic Logging

**What:** A middleware that logs every API request with method, path, status, duration, timestamp, correlation ID, and projectId (if derivable).

**Changes required:**
- New `request-log.json` store with bounded retention (e.g., 10,000 records)
- Express middleware wrapping the response to capture status + duration
- Aggregation queries for daily/hourly counts

**Effort:** Small — a single middleware + store.

**Risk:** Low — purely additive.

**Retention concern:** At 1,000 requests/day, 10K records = 10 days of history. At 10K requests/day, only 1 day. A bounded log is a snapshot, not a historical record.

### 11.3 LLM Usage Tracking

**What:** Intercept LLM API calls and log token counts (prompt, completion, total), model name, cost estimate, and correlation to session/mission.

**Changes required:**
- Modify `server/testGen.js` `callLLM` to capture and persist `response.usage`
- Modify `server/agent.js` SDK integration to intercept token usage (may not be possible without SDK cooperation)
- New `llm-usage.json` store with bounded retention
- Cost estimation table (model → $/1K tokens)

**Effort:** Medium-Hard — SDK token interception may not be feasible without SDK support.

**Risk:** Medium — adds latency to LLM calls (negligible), but SDK-level interception may be fragile.

### 11.4 Error Tracking

**What:** Structured error log capturing error type, message, stack, module, correlation ID, timestamp.

**Changes required:**
- Replace `console.error` calls with a structured error logger
- New `error-log.json` store with bounded retention
- Global error handler already exists (`uncaughtException`, `unhandledRejection`) — just needs to persist

**Effort:** Small-Medium — mostly finding and wrapping `console.error` calls.

**Risk:** Low — purely additive.

---

## 12. Security Requirements

### 12.1 Authentication

| Requirement | Current State | Gap |
|---|---|---|
| Long-lived credential | ✅ `QASE_API_TOKEN` is a static env var | None |
| Read-only | ✅ v2 router only has GET handlers | None |
| One credential reaches everything | ✅ Bearer token sees all projects | None for read access |

### 12.2 Authorization / Scoping

| Requirement | Current State | Gap |
|---|---|---|
| Project-scoped reads | ⚠️ `project_id` is an optional query param, not enforced | Dev Team agent could see all projects with one token |
| Workspace-scoped reads | ❌ Bearer auth has no workspace enforcement | Only HMAC auth has workspace scoping, but it's not on the v2 read path |
| User-level access control | ❌ No users | N/A |

**Recommendation:** If the Dev Team's agent should only see specific projects, we need to either (a) add project-scoping to the Bearer token, or (b) use a new auth mechanism that enforces project boundaries. If the agent should see everything, the current Bearer token is sufficient.

### 12.3 Sensitive Data Exposure

| Data | Sensitive? | Exposure Risk | Mitigation |
|---|---|---|---|
| Target URLs (`targetUrl` on missions/sessions) | ⚠️ Could contain internal URLs, staging environments, credentials in query params | Medium | Consider masking query params in target URLs |
| Mission `context.testCredentials` | ❌ HIGH — contains test credentials | High | Must NOT expose in usage endpoints |
| Config API key (`config.json`) | ❌ HIGH — LLM API key in plaintext | Critical | Already not exposed in any API endpoint |
| Session messages | ⚠️ May contain user input, URLs, content from target sites | Medium | Do not expose messages in usage endpoints |
| Findings `steps[]`, `evidence` | ⚠️ May contain screenshots, DOM content, URLs | Medium | Already exposed via v2 findings endpoint — review if Dev Team needs this |

### 12.4 Secrets / PII

| Category | Present in QASE? | Risk Level |
|---|---|---|
| API keys | ✅ LLM provider key in `config.json` | Critical — must never be exposed |
| Test credentials | ✅ In mission `context.testCredentials` | High — must never be exposed |
| User PII | ❌ No user data | None |
| Target URLs | ⚠️ Could reveal internal infrastructure | Medium |

### 12.5 Read-Only Enforcement

The v2 router (`pulseV2Router.js`) registers **only GET handlers**. There is no write path. The Dev Team's agent using a Bearer token on `/api/v2/*` can only read. ✅

### 12.6 Security Gaps to Address Before Implementation

1. **Project-scoping:** If the Dev Team should only see specific projects, Bearer auth needs project enforcement.
2. **Credential filtering:** Usage endpoints must NOT include `testCredentials`, `context`, or config data.
3. **Target URL masking:** Consider stripping query params from `targetUrl` in usage endpoints.

---

## 13. Performance & Scalability Requirements

### Current Data Volume

| Store | Records | File Size | Load Time (est.) |
|---|---|---|---|
| Missions | 3,479 | 18 MB | ~200 ms |
| Findings | 5,460 | 11.4 MB | ~150 ms |
| Sessions | 24 | 11.4 MB | ~150 ms |
| Fix Validations | ~500 | 4.3 MB | ~50 ms |
| Regression Runs | 200 | 297 KB | ~5 ms |
| Evidence Graph | — | 33.7 MB | ~400 ms |
| UX Assessments | — | 13.3 MB | ~200 ms |

**All data is loaded into memory on boot.** Every store uses `JSON.parse(readFileSync(...))` at startup. There is no lazy loading, no indexing, no query engine.

### Scale Projections

| Scenario | Data Volume | Impact | Mitigation |
|---|---|---|---|
| 10 projects, 100 missions/project | 1,000 missions, ~5 MB | ✅ Fast (<100 ms) | None needed |
| 100 projects, 1,000 missions/project | 100,000 missions, ~500 MB | ❌ `missions.json` = 500 MB — boot would take minutes, memory would be 1+ GB | Needs: lazy loading, pagination at storage level, or a real database |
| 1,000 projects | 1,000+ projects | ⚠️ `usage/projects` endpoint iterates all stores per project — O(projects × stores) | Needs: pre-computed project summaries |
| 10,000 users | N/A | ❌ No user concept | Needs: user tracking (see §11.1) |
| 100,000 users | N/A | ❌ No user concept | Needs: user tracking + database |
| Millions of events | Millions of findings/missions | ❌ JSON files would be GBs; `JSON.parse` would OOM | Needs: time-series database or at minimum SQLite with indexes |

### Endpoints That Would Become Expensive

| Endpoint | Why | At What Scale | Fix |
|---|---|---|---|
| `usage/overview` | Loads ALL stores to compute counts | 10K+ missions | Pre-compute a summary snapshot (periodic job) |
| `usage/projects` | Iterates all stores per project | 100+ projects | Pre-compute per-project summaries |
| `usage/timeseries` | Iterates all records to bucket by date | 10K+ records | Pre-compute daily/weekly buckets |
| Existing `metrics/dashboard` | Loads all sessions + findings in memory | Already a known issue | Pre-compute dashboard summary |

### Infrastructure Recommendation

**At current scale (3,479 missions, 5,460 findings):** No infrastructure changes needed. All proposed endpoints would respond in <1 second.

**At 10× scale (35K missions):** Add a periodic aggregation job that pre-computes daily/weekly/monthly summaries and stores them as a separate `usage-summaries.json`. Endpoints read summaries instead of raw records.

**At 100× scale (350K missions):** JSON file storage is no longer viable. Would need SQLite (minimum) or PostgreSQL with indexes. This is a larger architectural decision that should be deferred until scale demands it.

**Do NOT introduce Redis/Postgres/Kafka** at current scale. The existing JSON file architecture handles the data volume comfortably. Only recommend a database migration when the system hits clear performance limits.

---

## 14. OpenAPI Requirements for New Endpoints

Any new usage/traffic endpoints must follow the existing Pulse integration pattern:

| Requirement | How |
|---|---|
| Declare in `server/openapiDocument.js` | Add to `operations()` array |
| Implement in `server/pulseV2Router.js` | Add GET handler behind `requireApiToken` |
| Snake_case `operationId` ≤64 chars | e.g., `get_usage_overview`, `list_project_usage` |
| One-line `summary` | Required |
| `tags` | Use new tag: `Usage` or `Analytics` |
| Response schema | Every GET must have a response schema |
| Collections under `data` with `total` | For list endpoints |
| `page`/`page_size` with `default` 100, `maximum` 500 | On all collection endpoints |
| Enum filters | For closed value sets (e.g., `status: [active, inactive]`) |
| `from`/`to` date ranges | On time-based data |
| ISO 8601 UTC timestamps | All timestamps as `format: date-time` strings |
| Numbers as numbers | No stringified numbers |
| Stable `id` + `project_name` beside `project_id` | On all records carrying `project_id` |
| `additionalProperties` for free-form fields | Never `{"type": "null"}` |
| Auth via `bearerAuth` | Inherited from v2 router middleware |
| Read-only | GET handlers only |

---

## 15. Dev Team Questions

### Full Question List (25 questions)

1. **What questions will your agent ask?** What specific questions does the agent need to answer from QASE data? (e.g., "how many missions ran last week?", "what is the finding severity distribution?", "how many regression tests passed?")

2. **What metrics does it need?** Provide a list of metric names and definitions.

3. **What exactly is "traffic"?** Does it mean HTTP requests to QASE's API? Agent executions? Test runs? Webhook deliveries? Something else?

4. **What exactly is "usage"?** Does it mean how many QA missions were run? How many sessions were created? How many findings were reported? API calls to QASE?

5. **What is an "active user"?** QASE has no user accounts. Does "active user" mean a project that had activity? An integration key that was used? Something else?

6. **What is an "active project"?** A project with missions in the last 7 days? 30 days? A project with any data at all?

7. **Does the agent need raw events or aggregated data?** Does it want individual mission records, or daily/weekly summary counts?

8. **What time ranges are required?** Last 24 hours? Last 7 days? Last 30 days? All-time?

9. **What aggregation intervals are required?** Hourly? Daily? Weekly? Monthly?

10. **Does it need user-level data?** If yes, this requires new telemetry (QASE has no users).

11. **Does it need project-level data?** If yes, this is available today.

12. **Does it need workspace-level data?** Workspaces exist as an attribute, not as a queryable store. What workspace-level metrics are needed?

13. **Does it need AI/LLM/token/credit information?** If yes, this requires new telemetry (QASE does not track LLM usage).

14. **Does it need request counts?** If yes, this requires new telemetry (QASE has no request log).

15. **Does it need latency?** If yes, which latency — API response time? Mission execution time? Test execution time? (Only the latter two are available.)

16. **Does it need error rates?** If yes, what errors — HTTP 5xx? Mission failures? Test failures? (Only the latter two are available.)

17. **What polling frequency will the agent use?** Every 15 minutes? Hourly? Daily? This determines caching needs.

18. **What response time does the agent require?** <1s? <5s? <30s? This determines whether we need pre-computed summaries.

19. **What data retention does the agent expect?** 7 days? 30 days? 90 days? 1 year? QASE's current retention varies by store (50 sessions, 200 regression runs, 500 fix validations, unbounded missions/findings).

20. **What authentication does the agent support?** Bearer token? Custom header? Query parameter? QASE currently supports Bearer.

21. **Does it require one read-only credential?** Yes — QASE's Bearer token is read-only on the v2 surface. Can the agent use this?

22. **Does it require workspace/project scoping?** Should the agent only see certain projects, or is a global view acceptable?

23. **Can you provide sample requests?** Example API calls the agent would make.

24. **Can you provide expected sample responses?** The exact JSON shape the agent expects to receive.

25. **Can you provide the agent's required field names/schema?** Does the agent expect `mission_count` or `total_missions`? `project_id` or `projectId`? This determines our response shape.

---

## 16. Recommended Implementation Sequence

**Phase 0 (NOW):** Send Dev Team the 25 questions in §15. Do NOT implement until answers are received.

**Phase 1 (after answers):** Implement the endpoints marked READY:
- `GET /api/v2/usage/overview` — system-wide summary
- `GET /api/v2/usage/projects` — per-project usage summary

**Phase 2 (after answers):** Implement endpoints marked PARTIALLY READY, adjusted per Dev Team feedback:
- `GET /api/v2/usage/projects/{project_id}` — may overlap with existing `/api/v2/metrics/dashboard`
- `GET /api/v2/usage/timeseries` — needs bucket-size decision from Dev Team

**Phase 3 (if required by Dev Team):** Build telemetry for REQUIRES TELEMETRY endpoints:
- User tracking (if "users" is needed)
- Request logging (if "traffic" = HTTP requests)
- LLM usage tracking (if "usage" = token/cost)

**Phase 4:** Add all new endpoints to `server/openapiDocument.js` + `server/pulseV2Router.js` following the Pulse pattern. Add tests. Validate.

**Phase 5:** Provide the Dev Team with the updated `/openapi.json` URL and the Bearer token. Verify their agent can discover and call the endpoints.

---

## 17. Acceptance Criteria

The implementation is NOT complete until:

1. ✅ Dev Team confirms which metrics they need
2. ✅ Endpoints are implemented and return correct data
3. ✅ Endpoints are documented in `/openapi.json`
4. ✅ Dev Team's agent discovers QASE through the OpenAPI document
5. ✅ Dev Team's agent authenticates with the Bearer token
6. ✅ Dev Team's agent queries the required metrics
7. ✅ Dev Team's agent receives correct structured data
8. ✅ Dev Team's agent can answer its intended usage/traffic questions

**The OpenAPI document working is necessary but NOT sufficient.** The actual success criterion is the Dev Team's independent agent successfully answering user/project/traffic questions from QASE data.

---

## 18. Final Recommendation

**Do NOT build endpoints yet.**

The Dev Team's requirements are unknown. QASE has rich QA-domain data but lacks user, traffic, request, LLM-cost, and latency telemetry. Building endpoints now would mean guessing what the agent needs — and guessing wrong wastes effort and potentially exposes sensitive data.

**Send the Dev Team the 25 questions in §15 and the top-10 list below.** Build only what they confirm they need. The existing Pulse OpenAPI integration is the correct delivery mechanism — new endpoints should be added to the same `/api/v2/*` surface and documented in the same `/openapi.json`.

If the Dev Team's needs align with what QASE already has (QA activity, project usage, finding metrics, regression trends), implementation is straightforward — two READY endpoints, two PARTIALLY READY, all following the existing v2 pattern.

If they need user/traffic/LLM data, that requires new telemetry — a larger effort that should be planned separately.

---

## Concise Summary

### CURRENTLY AVAILABLE

- Project-scoped QA activity data: 3,479 missions, 5,460 findings, 200 regression runs, ~500 fix validations, 24 sessions, 3,460 test cases, 3 schedules
- All with timestamps (epoch ms, convertible to ISO 8601)
- All with project IDs (2 projects: Default, AI studio)
- Mission status/type/source enums, finding severity/category/status enums
- Regression pass/fail counts and trends (200 runs)
- Fix validation status and review trails (500 runs)
- Dashboard metrics endpoint (`/api/v2/metrics/dashboard`)
- OpenAPI 3.1 document with 30 GET operations at `/openapi.json`
- Bearer auth (long-lived, read-only on v2 surface)

### MISSING

- **No users** — no user accounts, no user store, no user identity on records
- **No LLM/token usage** — LLM calls are made but token counts and cost are not logged
- **No request/traffic log** — no request counter, no access log, no traffic tracking
- **No API latency tracking** — no HTTP response time measurement
- **No error log** — errors are console.error'd and lost
- **No global audit log** — no unified activity feed
- **Bug intel metrics** (in-memory only, reset on restart)
- **UX metrics** (in-memory only, reset on restart)
- **Session history bounded** (50 sessions / 12 MB — older sessions pruned)

### CANNOT DETERMINE WITHOUT DEV TEAM

- What "usage" means in their context
- What "traffic" means in their context
- What an "active user" is (QASE has no users)
- What an "active project" is
- Whether they need raw events or aggregated summaries
- What time granularity they need (daily? hourly? weekly?)
- Whether they need LLM/token/cost data (requires new telemetry)
- Whether they need HTTP traffic data (requires new telemetry)
- What field names/schema their agent expects
- What polling frequency they will use

### RECOMMENDED ENDPOINTS (subject to Dev Team confirmation)

1. `GET /api/v2/usage/overview` — **READY** — system-wide QA activity summary
2. `GET /api/v2/usage/projects` — **READY** — per-project usage summary
3. `GET /api/v2/usage/projects/{project_id}` — **PARTIALLY READY** — may overlap with existing dashboard endpoint
4. `GET /api/v2/usage/timeseries` — **PARTIALLY READY** — needs bucket-size decision

### ENDPOINTS THAT SHOULD NOT BE BUILT YET

5. `GET /api/v2/usage/users` — **REQUIRES TELEMETRY** — no user concept exists
6. `GET /api/v2/usage/traffic` — **REQUIRES TELEMETRY** — no request log exists
7. `GET /api/v2/usage/llm` — **REQUIRES TELEMETRY** — no LLM usage tracking exists

### TOP 10 QUESTIONS FOR DEV TEAM

1. What specific questions will your agent ask from QASE data?
2. What does "usage" mean — mission counts, session counts, API calls, or something else?
3. What does "traffic" mean — HTTP requests, agent executions, test runs, or something else?
4. Do you need user-level data? (QASE has no user concept today)
5. Do you need LLM/token/cost data? (QASE does not track this today)
6. Do you need HTTP request counts and latency? (QASE has no request log today)
7. Do you need raw events or aggregated summaries (daily/weekly counts)?
8. What time ranges and aggregation intervals do you need?
9. Can you provide sample expected requests and responses?
10. What field names does your agent expect (e.g., `mission_count` vs `total_missions`)?

### NEXT BUILD

1. **Send the Dev Team the 25 questions in §15**
2. Wait for answers
3. Implement only confirmed endpoints following the existing Pulse v2 pattern
4. Add to `/openapi.json`
5. Verify Dev Team's agent can discover, authenticate, and query