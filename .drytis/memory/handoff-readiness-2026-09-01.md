# External handoff readiness test — 2026-09-01

Black-box validation per user spec. Harness: `/workspace/handoff-test/` (hmac-client.mjs, schema-validate.mjs, golden-flow-runner.mjs, qase-external-demo.mjs — zero QASE-source imports, HTTP only).

## Result: 31/32 checks PASS

### Auth model (verified)
- **v2 read surface** (`/api/v2/*`, 32 GETs, live `/openapi.json`): bearer token (QASE_API_TOKEN) or user session. `/api/v2/health` public.
- **Integration surface** (`/api/v1/integration/*`): HMAC-SHA256 (`Authorization: QASE-HMAC-SHA256 keyId:ts:nonce:sig`, canonical = METHOD\nPATH\ntsMs\nnonce\nhex(HMAC-SHA256(key="",rawBody))). One shared env-only secret; keyIds are identities registered via `POST /api/v1/integration/keys` (admin key). Scopes + workspace binding enforced (403 `admin_required`, `scope_forbidden`, `workspace_forbidden`); nonce single-use (401 `replayed_nonce` verified live); ±5min timestamp window.

### Verified positives
- OpenAPI 3.1.0 live, 32 paths, 32/32 with 200 schemas, 31/32 with error responses
- 200 valid / 401 bad-sig / 401 unknown-key / 403 non-admin→admin-op / 401 no-auth
- Golden flow: usage/summary (schema-valid, buckets), projects, findings/stats?project_id (7569), regression/trend timeseries
- Pagination real (page/page_size echo, page2 ≠ page1), ISO-8601 timestamps, valid UUID ids, application/json content-type
- Negatives: 404 mission_not_found, 400 invalid_max_turns, 401 envelope stable, unknown filter → 200+0 not 500
- Zero-dependency demo client ran live: authenticated (HMAC), pulled usage/projects/findings, displayed results

### Findings (real, non-blocking)
1. **Schema drift**: `GET /api/v2/projects` returns `workspace_id: null` when unassigned; live spec declares `workspace_id: {type: string}` without nullable. Strict OpenAPI-3.1 consumers (code-gen, validators) will reject the response. Fix: `type: [string, "null"]` in Project schema (spec source: pulseV2Router/openapi doc builder) — NOT fixed per test rules (do not modify to pass).
2. **Live OpenAPI omits the integration surface**: `/api/v1/integration/*` (13 paths incl. missions create/report/findings/evidence/webhooks) documented only in docs/openapi.yaml + docs/integration-guide.md, not in `/openapi.json`. An external team discovering only via `/openapi.json` would miss the intended integration auth (they'd see bearer-only, which is the master token surface).

### Housekeeping
- Test key registered: keyId `ext-handoff-test`, workspace `handoff-ws`, principal integration (in .qase/integrations.json).
- No QASE code modified. Board API down (401) at test time — ticket could not be filed.
