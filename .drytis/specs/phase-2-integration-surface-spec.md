# Phase 2 — Integration surface in the live OpenAPI

## Goal
Document all 15 `/api/v1/integration/*` operations in the served `/openapi.json` with a dedicated HMAC security scheme, so an external app discovering only via the live spec finds the intended integration surface.

## Files to change
- `server/openapiDocument.js` (operations(), buildOpenApiDocument loop, components, tags, info.description)

## Work
1. **Lift builder limitations:**
   - Response codes are hardcoded (lines 830-840 emit only 200 + conditional 400/401/404). Add per-op `status`/`responses` override so POSTs can declare 201/202/403/409.
   - Security is binary (line 829: `op.public ? [] : [{bearerAuth: []}]`). Add per-op `security` override.
2. **Add `hmacAuth` securityScheme** to `components.securitySchemes` (alongside bearerAuth at :886-892): apiKey type, in: header, name: Authorization; description carries the full signing contract from docs/integration-guide.md — `Authorization: QASE-HMAC-SHA256 keyId:timestampMs:nonce:signature`, canonical string `METHOD\nPATH\ntsMs\nnonce\nhex(HMAC-SHA256(key="", rawBody))`, ±5min window, single-use nonces, and the 401/403 error codes (`unknown_key`, `bad_signature`, `stale_signature`, `replayed_nonce`, `invalid_auth_header`, `not_configured`, `admin_required`, `scope_forbidden`, `workspace_forbidden`).
3. **Document all 15 operations** (verified from server/index.js:1900-2310), porting/correcting schemas from docs/openapi.yaml:
   | # | Route | Success codes |
   |---|---|---|
   | 1 | GET /api/v1/integration/whoami | 200 |
   | 2 | POST /api/v1/integration/keys | 201 |
   | 3 | GET /api/v1/integration/keys | 200 `{integrations:[…]}` |
   | 4 | POST /api/v1/integration/missions | 202 / 201 / 200 (idempotent replay) / 409 idempotency_key_reused |
   | 5 | GET /api/v1/integration/missions/{id} | 200 |
   | 6 | GET /api/v1/integration/missions/{id}/report | 200 (json; text/markdown with ?format=md) |
   | 7 | GET /api/v1/integration/missions/{id}/decision-trace | 200 |
   | 8 | GET /api/v1/integration/missions/{id}/findings | 200 (default limit 50 — NOT 100) |
   | 9 | GET /api/v1/integration/missions/{id}/evidence | 200 |
   | 10 | POST /api/v1/integration/missions/{id}/stop | 200 |
   | 11 | POST /api/v1/integration/missions/{id}/start | 202 |
   | 12 | POST /api/v1/integration/webhooks | 201 |
   | 13 | POST /api/v1/integration/missions/{id}/revalidate | 202 |
   | 14 | POST /api/v1/integration/findings/{id}/revalidate | 202 / 200 idempotent / 409 active |
   | 15 | GET /api/v1/integration/findings/{id}/validation | 200 |
   Corrections vs docs/openapi.yaml: decision-trace exists on the server but not in the YAML (add it); GET /keys returns `{integrations:[…]}` not `keys:[…]`; 409 code undocumented; findings default limit 50 not 100.
4. Add `Integration` tag(s) to the tags array (:868-883); **delete the exclusion note** from `info.description` (:862): `'- /api/v1/integration/* — per-request HMAC signing; a pull connector cannot sign.'`
5. Commit immediately (protected-file check).

## Acceptance criteria (true in the running app)
- [ ] `/openapi.json` contains all 15 integration operations with correct methods and success status codes (202/201/200 as above)
- [ ] Every integration operation carries `security: [{ hmacAuth: [] }]` and the scheme documents the signing format + error codes
- [ ] `/openapi.json` no longer claims the integration surface is excluded
- [ ] An external consumer can generate a working integration client from `/openapi.json` alone (spot-check: whoami + mission create signatures match docs/integration-guide.md)
- [ ] `npm run test:openapi` passes; pulse-openapi-document/api tests pass

## Tests
- Extend `tests-real/pulse-openapi-document.test.js`: integration paths present (15), each with hmacAuth security and declared success responses; loosen the every-path-has-`get` assert (:53-60) to per-method
- Extend `scripts/validate-openapi.mjs`: lint non-GET ops too (today line 78 skips them) — operationId/summary/tags/responses for POSTs

## Edge cases
- POST bodies: missions create requires `context.maxTurns` 1-500 contract (400 invalid_max_turns) — document the 400
- 409 responses must be listed for missions-create and findings-revalidate
- Report endpoint has two content types (json + text/markdown via ?format) — document both
- Don't break the <8MB doc size limit (validate-openapi.mjs:162)
