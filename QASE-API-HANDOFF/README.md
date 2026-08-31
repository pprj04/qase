# Qase OpenAPI Handoff (Dev Team)

**Generated:** 2026-08-27 (post-restart) — fetched from the LIVE application's `GET /openapi.json`, not hand-written. `verification/validate.txt` holds the full validator run.

## The three Dev-Team requirements

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Production-accessible OpenAPI JSON URL | **`https://qase.drytis.com/openapi.json`** — verified 200, `application/json`, anonymous. The workspace preview serves the same route: `https://pulse-review-workspa-6grhjr.drytis.dev/openapi.json` (also 200, byte-identical). |
| 2 | Existing GET endpoints described by the document | **32 GET operations, 32 unique snake_case operationIds** (all ≤ 64 chars), zero non-GET operations. Validator: **0 violations**. |
| 3 | Separate read-only Bearer token | ⚠ **Does not exist yet** — see "Read-only token". |

## Provenance note (read before handing over)

The workspace was **reset to C3** (`2a22a74`) by the container restart on 2026-08-27 — all uncommitted post-C3 work was lost, including an OpenAPI guide-audit patch (envelope on `/projects` and `/regression/trend`, new filters, name joins, extra schema detail fields) that had NOT been committed or deployed. Production (`qase.drytis.com`) runs **C2** (`1766bec`).

This folder therefore contains the **C3 document** — valid and guide-clean (validator: 0 violations, 32 GETs) — but without those audit enhancements. If the Dev Team needs them, the audit must be redone and committed before any restart.

## Document facts

- OpenAPI **3.1.0**, title `Qase Read API (for Pulse)`, 17 component schemas.
- `servers[0].url` derives from the request Host at serve time; override with `QASE_PUBLIC_URL`.
- Documented security: `bearerAuth` (long-lived instance API token). All `/api/v2/*` operations are token-gated (401 anonymous, verified); `/openapi.json` itself is public.
- Collections return `{ data, total, page, page_size }` (defaults page=1, page_size=100, clamped to 500). Timestamps are ISO 8601 UTC.

### Operations by tag (32 total)

Meta 2 · Projects 1 · Missions 4 · Sessions 2 · Findings 4 · TestCases 3 · Workflows 2 · Suites 1 · Schedules 2 · Regression 3 · FixValidation 2 · Knowledge 2 · Metrics 2 · Usage 2

## Read-only token

The Pulse guide requires a **long-lived, read-only** credential (`Authorization: Bearer`). The app has exactly one static credential — the instance `apiToken` — which grants **full read+write** on everything under `/api` (settings, runs, missions, deletes). The `/api/v1/integration/keys` surface has scoped principals but authenticates via an **HMAC signed-request scheme, not a static Bearer**, so Pulse's connector cannot use it as-is.

**Options — no code written, awaiting the owner's decision:**

- **A (minimal):** dedicated long-lived token accepted only for `GET` on `/api/v2/*`; rejected elsewhere with 401. Small, contained middleware change.
- **B:** extend integration-keys to also issue a static Bearer with `read_only` scope.
- **C:** hand over the existing instance `apiToken` — works today but is NOT read-only (against the guide's intent).
