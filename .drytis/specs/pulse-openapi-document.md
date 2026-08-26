# Task: Pulse-ready OpenAPI document for the Qase read API

## Context

Drytis Pulse onboards APIs through an `openapi` connector that reads ONE JSON document
(`GET /openapi.json`), turns every declared `GET` into an agent tool, and calls the API
with a long-lived Bearer credential. The pasted Pulse build guide defines the contract:
JSON (not YAML) at a stable URL on the API host, snake_case `operationId` ≤ 64 chars +
summary + tags per operation, response schema on every GET (collections = `data` +
integer `total`), `page`/`page_size` with default/maximum on collections, enums for
closed sets, `from`/`to` (`format: date`) on time-based lists, ISO 8601 UTC timestamps,
numbers as numbers, stable `id` + human-readable name beside every foreign id,
`additionalProperties` maps (never `{"type":"null"}`), answers < 30s.

### Current state (audit)

- `docs/openapi.yaml` exists but is YAML, covers only the 13-path HMAC
  `/api/v1/integration/*` surface (per-request HMAC signing — a pull connector like
  Pulse cannot sign requests, so that surface is unusable for it), and has **no
  operationIds and no GET response schemas**.
- The Bearer-token surface (`requireApiToken`: `Authorization: Bearer <QASE_API_TOKEN>`,
  long-lived static token) is the right Pulse surface but:
  - list endpoints return bare arrays, or `{items,total,limit,offset}` only when
    `?limit=` is sent — never Pulse's `{data,total}` convention;
  - timestamps are epoch **milliseconds** everywhere;
  - no `project_name` beside `project_id` (charts would be UUID-labelled);
  - no `from`/`to` range filters;
  - `/api/knowledge` is unpaginated and unbounded;
  - `/api/regression/runs` `limit` param is uncapped.

### Key architectural decision (new in this revision)

The SPA and existing tests depend on legacy shapes (epoch-ms timestamps, array
responses, `updatedAt - createdAt` arithmetic in `public/executionDetail.js:46`,
`Date.now() - ts` in `public/shared.js:234`, etc.). Mutating the legacy endpoints in
place would break the UI and every existing consumer. **Solution: a dedicated
versioned read façade `/api/v2/*`** that returns exactly what the document declares,
while legacy routes remain byte-identical. The document serves as the single source of
truth; a `server/pulseProjection.js` module projects records to documented shape.

## Scope

**In:** generated `GET /openapi.json` (JSON, Pulse read surface, Bearer auth); a
`/api/v2/*` read façade implementing every operation in the document; a guide-rule
validator (`scripts/validate-openapi.mjs`, `npm run test:openapi`); unit tests
(`tests-real/pulse-openapi-document.test.js`) + integration tests
(`tests-real/pulse-openapi-api.test.js`); operationIds + GET response schemas added to
the legacy `docs/openapi.yaml` (doc-only).

**Out:** scoped read-only credentials (flagged as follow-up — current token is
read-write; the Pulse connector only ever calls GET, and the document declares
read-only intent); HMAC integration surface behavior; SSE stream, binary artifacts,
file exports (excluded from the document by design, with reasons in
`info.description`); no new dependencies.

## The v2 read façade

All endpoints: `requireApiToken` (Bearer), ISO 8601 UTC timestamps, snake_case field
names, `project_name` / `mission_name` / `session_title` / `schedule_name` joins,
`{data, total, page, page_size}` envelope with clamping (default 100 / max 500),
`from`/`to` date filtering (`from` inclusive, `to` exclusive), 400 on invalid date
values, 404 single-record misses.

| Operation | Path (all under `/api/v2`) | Notes |
|---|---|---|
| health | `/health` | no auth |
| listProjects | `/projects` | bare array (bounded, small) — documented as such |
| listMissions | `/missions` | filters: project_id, status, type, source, from/to (created_at) |
| getMission | `/missions/{id}` | full record (steps/summary included; heavy arrays off by default) |
| listMissionSummaries | `/v1-missions` → **`/mission-summaries`** | maps v1 `/api/v1/missions` payload incl. queueDepth/governor extras |
| getMissionStatus | `/mission-status/{id}` | maps v1 `/api/v1/missions/:id` (lazy-finalizing) |
| listSessions | `/sessions` | project_id, from/to |
| getSession | `/sessions/{id}` | counts + device/pipeline metadata |
| listFindings | `/findings` | full filter set incl. q, reproducibility, primary_category |
| getFinding | `/findings/{id}` | |
| getFindingStats | `/findings/stats` | |
| getFindingsGrouped | `/findings/grouped` | groupBy enum |
| listTestCases | `/test-cases` | workflow_id, suite_id, tag, target_url, from/to |
| getTestCase | `/test-cases/{id}` | |
| listTestCaseTags | `/test-cases/tags` | `{data,total}` of strings |
| listWorkflows | `/workflows` | project_id, target_url, from/to |
| getWorkflow | `/workalleries/{id}` → `/workflows/{id}` | full record with steps |
| listSuites | `/suites` | bounded |
| listSchedules | `/schedules` | bounded, next_run/last_run ISO |
| listScheduleRuns | `/schedules/{id}/runs` | from/to on ts |
| listRegressionRuns | `/regression/runs` | project_id, schedule_id, target_url, from/to |
| getRegressionRun | `/regression/runs/{id}` | per-test results; no junit here (export) |
| getRegressionTrend | `/regression/trend` | array of TrendPoint |
| listFixValidations | `/fix-validations` | fix_status filter; metrics beside data |
| getFindingValidation | `/findings/{id}/validation` | latest/history/metrics |
| listKnowledgePatterns | `/knowledge` | from/to on lastSeen; `{data,total,stats}` |
| getKnowledgePattern | `/knowledge/{id}` | provenance record |
| getDashboardMetrics | `/metrics/dashboard` | nested blocks; ISO ts inside recentTrend |
| getUxMetrics | `/metrics/ux` | counters |
| getBugTaxonomy | `/bug-taxonomy` | maps `/api/bug-intelligence/enums` |

## Envelope contract

`page`/`page_size` → `{ data, total, page, page_size }` (+ legacy extras like
`queueDepth`/`governor`/`metrics`/`stats` where the source endpoint carried them).
Without paging params → same envelope with defaults (page=1, page_size=100) — v2 is a
new surface, so no legacy consumers exist to preserve; the envelope is ALWAYS present
on v2 collections. `page_size` clamped to 500.

## Documented enums

mission status (8) / types (6) / sources (3); session status (6); finding severity (5) /
legacy status (4) / lifecycle (12) / review (5) / priority (P0–P3 + UNTRIAGED) /
reproducibility (7 incl. legacy) / categories (20); fix run status (6) / fixStatus (5) /
review states (5); knowledge status (3); groupBy (6). Schemas mirror live store enums —
asserted by unit tests.

## Acceptance criteria

- [ ] `GET /openapi.json` → `200 application/json`, OpenAPI 3.1.0, `servers[0].url`
      non-empty (request origin, or `QASE_PUBLIC_URL` when set), `security: bearerAuth`
      declared; JSON (not YAML); < 8 MB.
- [ ] Every documented GET has: unique snake_case `operationId` ≤ 64 chars, one-line
      `summary`, `tags`, a `200` response schema.
- [ ] Every v2 collection endpoint returns `{data,total,page,page_size}`; `total` =
      matching rows ignoring paging; `page_size` clamped to 500; `page` ≥ 1.
- [ ] `page`/`page_size` declared with `default` 100 and `maximum` 500 on every
      collection; `from`/`to` (`format: date`) declared and functional on all
      time-based collections; invalid date → 400.
- [ ] Closed value sets declared as `enum`s.
- [ ] All timestamps in v2 payloads are ISO 8601 UTC strings; durations stay numbers.
- [ ] `project_name` beside `project_id` on missions, sessions, findings, test cases,
      workflows, suites, schedules, regression runs, fix-validation runs;
      `mission_name`/`session_title` on findings and sessions; `schedule_name` on
      regression runs (omitted when the foreign record is absent).
- [ ] No standalone `{"type": "null"}` anywhere (3.1 nullability via `anyOf`); free-form
      objects use `additionalProperties`.
- [ ] `scripts/validate-openapi.mjs` exits 0 on the live served document; wired as
      `npm run test:openapi`.
- [ ] Unit tests + integration tests pass; pre-existing suites (node-test unit + api
      + contract) still pass — legacy shapes untouched.
- [ ] `docs/openapi.yaml` GETs have operationIds + response schemas.
- [ ] Excluded-from-doc endpoints (SSE, artifacts, exports, HMAC integration surface)
      listed in `info.description` with reasons.

## Test plan

1. Unit (`pulse-openapi-document.test.js`): document-level rules mechanically —
   operationId uniqueness/length/snake_case, GET response schemas present, collection
   response shape, param defaults/maxima, enums present, no standalone type:null,
   date-time formats, envelope schema shape.
2. Integration (`pulse-openapi-api.test.js`, live server via `QASE_BASE_URL` +
   `QASE_API_TOKEN`, same convention as `phase16-api.test.js`): /openapi.json served +
   valid + JSON content type; each v2 collection: envelope present, total ≥ data.length,
   ISO timestamp regex on records, project_name join; from/to filtering (create
   finding via legacy POST, verify filter window, cleanup); page_size clamp (send
   page_size=999, expect 500); invalid from → 400; 404 on unknown id; legacy endpoint
   shape unchanged (array, epoch ts) before/after.
3. `npm run test:openapi` fetches the LIVE served doc and runs the rule linter
   (exit code gates CI).
4. Existing gate categories re-run to prove backward compatibility.
