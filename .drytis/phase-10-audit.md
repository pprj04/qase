# Phase 10 — Integration Foundation & Authentication Audit

**Date:** 2026-08-12
**Status:** COMPLETE — audit finished before any implementation

---

## 1. Existing Authentication

**Mechanism:** Single shared static bearer token (`QASE_API_TOKEN`).

- Set via `QASE_API_TOKEN` env var or `.qase/config.json`
- Middleware `requireApiToken` (index.js:164) validates via:
  1. Bearer header: `Authorization: Bearer <token>` — timing-safe comparison
  2. Cookie: `qase_token=<token>` — auto-set by `setAuthCookie` for same-origin browser UI
- When no token is configured → all routes open (backwards-compat for local single-user)
- Applied selectively to mutating routes (`POST/PUT/DELETE/PATCH`); most GET routes are open

**Verdict:** Functional for single-user, but NOT suitable for multi-tenant integration. No per-user identity. Token is shared — anyone who has it has full access to everything.

## 2. Existing Authorization

**None.** The token is a binary gate (have it / don't). There is:
- No per-resource ownership check
- No workspace/organization scoping
- No role-based access control
- No server-side ownership resolution

Any authenticated caller can read/modify ANY mission, session, finding, evidence, or artifact regardless of which project it belongs to.

## 3. Existing Identity Model

**No user identity exists.** There is no `userId`, `workspaceId`, `organizationId`, or `ownerId` anywhere in the codebase. The Drytis environment provides:
- `GIT_USER_NAME` / `GIT_USER_EMAIL` (for git commits only)
- Container `password` (for workspace access)
- No identity tokens or claims

The session state carries `current_user_id: '392:project:2516'` but this is a platform-level concept that QASE never reads.

## 4. Existing Project/Workspace Model

**Projects** (`server/projects.js`):
- Fields: `id`, `name`, `baseUrl`, `createdAt`, `updatedAt`
- A "Default" project is auto-created on boot
- All entities (sessions, missions, findings, workflows, test cases, schedules, regression runs, suites) carry a `projectId`
- `projectId` is used for **filtering/grouping only** — NOT for access control
- No workspace/organization layer above projects

**Missions** (`server/missions.js`):
- Fields include: `id`, `projectId`, `source` ('manual'|'api'|'ai_studio'|'ci_cd'), `generationId`
- `generationId` is persisted and queryable (used in report endpoint)
- No `workspaceId` or `userId`

**Sessions** (`server/store.js`):
- Fields: `id`, `title`, `projectId`, `targetUrl`, timestamps, status
- No `workspaceId` or `userId`

## 5. Existing Integration Endpoints

The `/api/v1/*` namespace is explicitly designed as the integration contract:

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/v1/missions` | POST | requireApiToken | Create + optionally start mission |
| `/api/v1/missions/:id/start` | POST | requireApiToken | Start a created mission |
| `/api/v1/missions/:id` | GET | requireApiToken | Get status + results |
| `/api/v1/missions/:id/stop` | POST | requireApiToken | Abort running mission |
| `/api/v1/missions/:id/iterate` | POST | requireApiToken | Trigger next iteration |
| `/api/v1/missions/:id/revalidate` | POST | requireApiToken | Trigger revalidation iteration |
| `/api/v1/missions/:id/loop-status` | GET | requireApiToken | Validation loop status |
| `/api/v1/missions/:id/comparison` | GET | requireApiToken | Iteration comparison |
| `/api/v1/missions/:id/report` | GET | requireApiToken | Mission report (JSON/Markdown) |
| `/api/v1/missions/:id/evidence` | GET | requireApiToken | Evidence for mission |
| `/api/v1/missions/:id/evidence-coverage` | GET | requireApiToken | Evidence coverage metric |
| `/api/v1/missions/:id/evidence-integrity` | GET | requireApiToken | Graph integrity check |
| `/api/v1/missions/:id/understanding` | GET | requireApiToken | App understanding |
| `/api/v1/missions/:id/workflows` | GET | requireApiToken | Workflow model |
| `/api/v1/missions/:id/intent` | GET | requireApiToken | Mission intent |
| `/api/v1/webhooks` | POST | requireApiToken | Register webhook |
| `/api/v1/domains` | GET | requireApiToken | Domain catalog |
| `/api/v1/evidence/*` | GET | requireApiToken | Evidence queries |

Additionally, 95 internal `/api/*` routes serve the dashboard UI (mix of auth/no-auth).

**Webhooks** (`index.js:2402`): In-memory map, mission-scoped. Fired on mission completion.

## 6. Existing Security Controls

| Control | Status | Notes |
|---------|--------|-------|
| Bearer token auth | ✅ Present | Shared static token, timing-safe |
| Cookie auth (browser UI) | ✅ Present | HttpOnly, SameSite=Strict |
| Credential vault | ✅ Present | Secrets never reach model; placeholder substitution |
| Secret redaction | ✅ Present | Deep-walk redaction of vault values |
| Path traversal protection | ✅ Present | Artifact serving validates filenames |
| XSS protection | ✅ Present | escapeHtml before markdown rendering |
| CORS | ❌ Not configured | |
| Rate limiting | ❌ Not present | |
| Per-user identity | ❌ Missing | |
| Resource authorization | ❌ Missing | |
| Token expiry | ❌ Missing | Static token never expires |

## 7. What Can Be Reused

1. **`requireApiToken` middleware pattern** — extend with identity extraction
2. **Bearer/Cookie dual-auth** — keep for browser UI, add JWT for integration
3. **`projectId` on all entities** — already persisted, just needs ownership semantics
4. **`generationId` on missions** — already persisted and queryable
5. **`/api/v1/*` namespace** — already the integration boundary, all require auth
6. **`jose` library** — available in node_modules, modern JWT/JWS/JWE
7. **Webhook system** — extend with correlation info
8. **`source` field on missions** — already distinguishes 'api'/'ai_studio'/'ci_cd'

## 8. What Is Missing

1. **Per-user identity** — no userId, workspaceId anywhere
2. **JWT/token validation** — only static shared token
3. **Resource-level authorization** — any caller sees everything
4. **Workspace/organization concept** — no layer above projects
5. **CorrelationId/traceability** — no request tracking across the pipeline
6. **Idempotency** — repeated mission creation creates duplicates
7. **Integration context object** — no shared context for downstream services
8. **Token expiry handling** — static token never expires
9. **API classification** — internal vs integration routes not formally separated

## 9. What Must Change

1. **Add identity layer**: Accept Drytis-issued JWT in Authorization header; verify signature, extract claims (userId, workspaceId, projectId, roles)
2. **Add workspace ownership to projects**: Projects get `workspaceId`; missions/sessions inherit it via project
3. **Add authorization middleware**: Resolve entity ownership server-side; reject cross-workspace/cross-project access
4. **Add correlation tracking**: Accept/generate `X-Correlation-Id`; thread through mission → session → findings
5. **Add idempotency**: Deduplicate mission creation by (workspaceId + generationId + targetUrl)
6. **Create integration context**: Attach `req.integration` with identity + workspace + project + correlationId
7. **Classify APIs**: Mark integration routes, keep internal routes separate
8. **Backward compatibility**: Existing API token still works for single-user/dashboard use

## 10. Security Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Any caller can access any mission | HIGH | Add workspace-scoped authorization |
| No identity in requests | HIGH | Require JWT for integration endpoints |
| Static token never expires | MEDIUM | Support JWT with expiry for integration |
| Client-supplied projectId trusted | MEDIUM | Resolve ownership server-side |
| No idempotency → duplicate missions | MEDIUM | Idempotency key deduplication |
| Secrets in API responses | LOW | Already mitigated by vault/redaction |
| No correlation → untraceable requests | LOW | Add correlationId threading |

## 11. Migration Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing API token auth | All existing integrations stop | Keep requireApiToken as fallback; JWT is additional |
| Breaking dashboard UI | Browser stops working | Cookie auth preserved unchanged |
| Breaking existing tests | Regression failures | Add new auth as additive layer; don't remove existing |
| Data without workspaceId | Existing entities have no owner | Backfill to default workspace; treat null as "internal" |
| Performance overhead | JWT verification per request | Use symmetric HS256; verify is <1ms |

## 12. Exact Implementation Plan

### Step 1: Identity Boundary
- Minimum identity: `userId`, `workspaceId`, `projectId` (optional), `roles` (optional)
- Delivered via HS256-signed JWT in `Authorization: Bearer <jwt>` header
- QASE verifies using `QASE_INTEGRATION_SECRET` env var (shared with Drytis)
- Falls back to existing API token for backward compatibility

### Step 2: Authentication Module (`server/integrationAuth.js`)
- `verifyIntegrationToken(header)` → returns `{ userId, workspaceId, projectId, roles }` or null
- `createIntegrationContext(req)` → builds context object from verified token
- `requireIntegrationAuth` middleware — accepts JWT OR existing API token
- Token logging prevention — never log token values

### Step 3: Authorization Module (`server/authorization.js`)
- `resolveWorkspace(entity)` → returns workspaceId from entity or its project
- `authorizeAccess(integrationCtx, entity)` → boolean
- `authorizeProjectAccess(integrationCtx, projectId)` → boolean
- Cross-workspace/cross-project rejection

### Step 4: Project/Workspace Identity
- Add `workspaceId` to project model
- Missions/sessions inherit workspaceId via project chain
- Backfill existing data to a default workspace

### Step 5: Integration Context
- `req.integration = { identity, workspace, project, correlationId }`
- Available to all downstream handlers without re-parsing

### Step 6: API Protection
- Integration routes (`/api/v1/*`): require JWT identity (or API token fallback)
- Internal routes (`/api/*`): keep existing auth (cookie/token)
- Public routes (`/api/health`): no auth

### Step 7: Idempotency
- Key: `workspaceId + generationId + targetUrl` (when generationId present)
- Store `idempotencyKey` on mission
- Return existing mission if key matches and is not in terminal-failed state

### Step 8: Correlation
- Accept `X-Correlation-Id` header; generate if absent
- Store on mission; include in API responses
- Thread to session, findings, evidence

### Step 9: Security Tests (18 scenarios)
- All specified test cases as integration tests

### Step 10: Regression
- Run full 693-test suite
- Zero new failures

### Step 11: Integration Simulation
- Simulated Drytis-authenticated request → QASE pipeline
- Prove identity flow end-to-end
