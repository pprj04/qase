# QASE Dev Team Integration Playbook — Usage / Traffic / Activity API

**Audience:** the Dev Team's external agent that tracks usage, user statistics, traffic, and activity across projects.
**Goal:** integrate QASE through this document alone — no QASE UI, no source-code reading, no tribal knowledge.

---

## 1. What QASE is (30 seconds)

QASE is an autonomous QA agent. You point it at a web app (a *mission*); it explores the app,
reports defects (*findings*) with evidence, validates fixes (*fix-validations*), and can run
scheduled regression suites. Everything the Dev Team wants to track is **activity on those artifacts**.

> **Terminology warning:** "traffic" here means **activity through QASE's API** (missions run,
> findings reported, API requests served). It is NOT your app's HTTP traffic — QASE does not sit
> in front of your web traffic and does not proxy page views.

## 2. Authentication

| | |
|---|---|
| Scheme | `Authorization: Bearer <QASE_API_TOKEN>` |
| Token source | QASE Settings → API token (instance operator provides it) |
| Public endpoints | **Exactly one:** `GET /api/v2/health` |
| Everything else | 401 without/with bad token |
| Correlation | Send `X-Correlation-Id` (1–128 chars) on any request; QASE echoes it on the response and attaches it to internally spawned work |

```bash
curl -H "Authorization: Bearer $QASE_API_TOKEN" \
     -H "X-Correlation-Id: my-agent-req-42" \
     https://<qase-host>/api/v2/usage/summary
```

Invalid token → `401 {"error":"Invalid or missing API token…"}` (flat envelope, timing-safe compare).

## 3. Endpoint reference — the 8 endpoints the usage agent needs

Full machine-readable contract: **`GET /openapi.json`** (OpenAPI 3.1, 32 paths).
All list endpoints share this envelope unless noted:

```json
{ "data": [ ... ], "total": 1625, "page": 1, "page_size": 100 }
```

- Pagination: `?page=1&page_size=100` (default 100, hard max 500).
- Date filters on all activity endpoints: `?from=YYYY-MM-DD&to=YYYY-MM-DD` — `from` inclusive,
  `to` exclusive, invalid values → `400`.
- All timestamps ISO-8601 UTC.

| # | Question | Endpoint |
|---|---|---|
| 1 | Is QASE up? | `GET /api/v2/health` (no auth) |
| 2 | Which projects exist? | `GET /api/v2/projects` → **bare array** (small bounded collection) |
| 3 | How much testing happened? | `GET /api/v2/usage/summary?from=…&to=…&bucket=day\|hour` |
| 4 | Mission-level detail / drill-down | `GET /api/v2/missions?project_id=…&status=…&from=…` |
| 5 | How many defects found? | `GET /api/v2/findings?project_id=…` (+`/findings/stats`, `/findings/grouped`) |
| 6 | Are fixes landing? | `GET /api/v2/fix-validations?from=…` (VERIFIED_FIXED / STILL_BROKEN / REGRESSED …) |
| 7 | Regression health over time | `GET /api/v2/regression/trend?limit=20` → **bare array** of `{ts,total,passed,failed,pass_rate}` |
| 8 | API traffic on QASE itself | `GET /api/v2/metrics/api-usage` |

### `GET /api/v2/usage/summary` — the headline endpoint

```json
{
  "window": {
    "from": "2026-08-19T00:00:00.000Z",
    "to": "2026-08-26T00:00:00.000Z",
    "bucket": "day"
  },
  "totals": {
    "missions_created": 1625, "missions_completed": 685,
    "findings_reported": 3688, "fix_validations": 500, "regression_runs": 200
  },
  "mission_source_mix": { "api": 1083, "integration": 542 },
  "mission_status_mix": { "completed": 573, "failed": 400, "…": 0 },
  "buckets": [ { "bucket": "2026-08-20", "missions_created": 127, "…": 0 } ]
}
```

Defaults to the last 7 days when `from`/`to` are omitted. Single-sided windows work:
`from` only → buckets extend to now; `to` only → from the oldest record. The `window`
object always echoes the **effective** bounds that were bucketed.

### `GET /api/v2/metrics/api-usage` — QASE's own API traffic

```json
{ "data": [ { "day": "2026-08-26", "total": 66,
              "endpoints": { "/findings": 17, "/usage/summary": 9 } } ],
  "total": 1, "page": 1, "page_size": 100, "since": "2026-08-26T15:46:02.914Z" }
```

**Honest limit:** counts begin at telemetry deployment — `since` says when; there is no backfill.
Counts only **authenticated** reads of `/api/v2/*`. At most 90 days × 200 endpoint patterns are
retained; overflow patterns roll into `__other__`.

## 4. What "user statistics" means here

QASE is currently single-operator (no per-user accounts on the read surface). "Users" therefore
decompose into:

- **Who drives testing** → `mission_source_mix` (`api` = operator UI/API, `integration` = external
  HMAC-authenticated clients) — see `GET /api/v2/usage/summary`.
- **Where activity lands** → filter any activity endpoint by `project_id`.

If the Dev Team needs per-human-user attribution, that is **not currently collected** — see §7.

## 5. Rate/scale expectations

Measured on this instance (3,479 missions, 5,469 findings on disk):

- `/api/v2/missions?page_size=500` ≈ 14 ms / 281 KB
- `/api/v2/findings?page_size=500` ≈ 22 ms / 769 KB
- `/api/v2/metrics/dashboard` ≈ 2 ms / 2.8 KB
- 20 concurrent reads: all 200, p50 < 100 ms

Paginate with `page_size ≤ 500`; don't fetch full datasets in one call.

## 6. Reference client

`examples/dev-agent/dev-agent.mjs` — zero-dependency Node (18+) script that authenticates,
answers all 8 questions above, and demonstrates error handling. Run:

```bash
QASE_BASE_URL=https://<qase-host> QASE_API_TOKEN=… node examples/dev-agent/dev-agent.mjs
```

Expected final line: `DEV-AGENT FLOW: PASS`. It also proves the negative paths:
malformed date → 400, anonymous → 401.

## 7. What QASE does **not** currently provide

| Requirement | Status | Why |
|---|---|---|
| Per-human-user statistics | ❌ not collected | No per-user actor field exists on any record |
| Your app's HTTP traffic | ❌ out of scope | QASE is not a proxy/analytics sink for app traffic |
| Historical API traffic before deployment | ❌ no backfill | Telemetry starts at `since` |
| Everything else in the brief | ✅ | via §3 endpoints |

## 8. Incident / error quick reference

| HTTP | Meaning | Client action |
|---|---|---|
| 400 | malformed query (e.g. `from=not-a-date`) | fix the parameter |
| 401 | missing/invalid token | check `Authorization: Bearer` |
| 404 | unknown id | don't retry |
| 5xx | QASE-side failure | retry with backoff; keep `X-Correlation-Id` for support |
