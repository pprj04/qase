# Phase 16 — Integration Audit

## Drytis Integration Readiness Assessment

**Date: 2026-08-14**
**Baseline: Phase 15 PASS/FROZEN (735 tests, 0 new failures)**

---

## 1. Two API Tiers

QASE has two distinct API surfaces:

### Dashboard Tier (`/api/*`, no `v1` prefix)
- Auth: `requireApiToken` (Bearer token or `qase_token` cookie)
- No workspace/project scoping — open to any authenticated caller
- Used by the QASE dashboard UI
- **NOT the integration contract**

### Integration Tier (`/api/v1/*`)
- Auth: `requireIntegrationAuth` — Drytis JWT takes precedence, falls back to legacy API token
- Per-resource authorization via `authorizeMissionAccess` / `authorizeSessionAccess`
- Workspace + project scoping for JWT-authenticated callers
- **This is the Drytis integration contract**

---

## 2. Complete v1 API Surface

### Authentication

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| ANY | `/api/v1/*` | `requireIntegrationAuth` | JWT (HS256, 15-min TTL) or legacy API token |

Auth failures return `401 { error: "Authentication required", detail: "..." }`.

### Mission Lifecycle

| Method | Path | Auth | Body | Response | Async |
|--------|------|------|------|----------|-------|
| GET | `/api/v1/missions` | yes | — | `{ missions: [...], total, limit, offset }` | No |
| POST | `/api/v1/missions` | yes + workspace | `{ targetUrl, name?, type?, buildPrompt?, requirements?, workspaceId?, generationId?, autoStart? }` | `202 { missionId, sessionId, status, correlationId, reportUrl }` or `201 { missionId, status: "created" }` or `200 { idempotent: true }` | Yes (agent runs async) |
| GET | `/api/v1/missions/:id` | yes | — | Full mission object (see Step 5) | No (syncs session state) |
| POST | `/api/v1/missions/:id/start` | yes | — | `202 { missionId, status: "running" }` | Yes |
| POST | `/api/v1/missions/:id/stop` | yes | — | `200 { aborted: true }` | No |
| POST | `/api/v1/missions/:id/revalidate` | yes | — | `202 { iteration }` | Yes |

### Result Retrieval

| Method | Path | Auth | Response |
|--------|------|------|----------|
| GET | `/api/v1/missions/:id/report` | yes | Full report JSON (verdict, qualityScore, findings, recommendations, decision, improvementPrompt) or markdown |
| GET | `/api/v1/missions/:id/evidence` | yes | Paginated evidence `{ evidence: [...], totalEvidence, limit, offset }` |
| GET | `/api/v1/missions/:id/evidence-coverage` | yes | Coverage stats `{ verified, partial, unverified }` |
| GET | `/api/v1/missions/:id/evidence-integrity` | yes | Integrity report |
| GET | `/api/v1/missions/:id/understanding` | yes | App understanding model |
| GET | `/api/v1/missions/:id/workflows` | yes | Workflow test results |
| GET | `/api/v1/missions/:id/loop-status` | yes | Validation loop status |
| GET | `/api/v1/missions/:id/findings/:findingId/evidence-chain` | yes | Finding-specific evidence chain |

### Webhooks

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/api/v1/webhooks` | yes | `{ missionId, url, events? }` | `201 { webhookId, secret, signatureHeader: "X-Qase-Signature" }` |
| GET | `/api/v1/webhooks/:webhookId/delivery` | yes | — | `{ webhookId, deliveries: [...] }` |

Webhook delivery: HMAC-SHA256 signed, 3 retries (2s→4s→8s backoff), 10s timeout, SSRF protection. Lean payload (not full report). Webhook failure NEVER affects mission state.

---

## 3. Mission Lifecycle States

```
created → queued → running → completed
                          → failed
                          → aborted (via POST /:id/stop)
                          → cancelled
                          → timeout
```

Terminal states: `completed`, `failed`, `aborted`, `cancelled`, `timeout`

Three finalization paths:
1. **Lazy**: `GET /api/v1/missions/:id` detects session done → calls `finalizeMissionFromSession`
2. **Periodic**: Finalizer runs every 30s, checks for idle sessions
3. **Event**: Capability orchestrator emits `finalized` via missionBus

`finalizeMission` is idempotent — safe to call multiple times.

---

## 4. Idempotency

Key: `${workspaceId}:${generationId}:${targetUrl}`

Active when BOTH `workspaceId` AND `generationId` are present in the request body.

Repeated request returns `200 { idempotent: true, missionId, sessionId, status, ... }` — no duplicate mission or session created.

Without `generationId`, each request creates a new mission (no deduplication).

---

## 5. Correlation ID

Source: `X-Correlation-Id` or `X-Request-Id` header (index.js:111-112).

Stored on mission as `mission.correlationId`. Returned in all v1 mission responses.

No body-field correlation ID (header-only). Drytis should send `X-Correlation-Id` on every request.

---

## 6. Integration Gaps Found

| # | Gap | Severity | Status |
|---|-----|----------|--------|
| 1 | No `GET /api/v1/missions` list endpoint | Medium | **FIXED** — added in Phase 16 |
| 2 | Webhook registry is in-memory (lost on restart) | Low | Documented — acceptable for integration-ready state |
| 3 | Legacy API token = full admin (no workspace isolation) | Medium | By design — JWT callers get proper isolation |
| 4 | Open-access fallback if `QASE_API_TOKEN` unset | Low | Deployment concern — documented |
| 5 | Pipeline stages not persisted (live-only) | Low | Summary-only stub returns `stages: null` — handled |

---

## 7. What Already Existed (Pre-Phase 16)

- ✅ Full v1 API with JWT auth (Phase 10)
- ✅ Workspace/project authorization (Phase 10)
- ✅ Idempotent mission creation (Phase 10)
- ✅ Webhook registration + HMAC delivery + retry (Phase 10)
- ✅ Mission lifecycle (created → running → completed/failed/aborted)
- ✅ Result delivery: polling (GET mission), webhook (POST register), report (GET report)
- ✅ Correlation ID tracking via headers
- ✅ Evidence, understanding, workflows, loop-status APIs
- ✅ Quality scoring + decision engine
- ✅ Knowledge learning loop

## 8. What Was Added (Phase 16)

- `GET /api/v1/missions` — list endpoint with pagination and filtering
- Pipeline-status endpoint fix (stages: null for summary-only stubs)
- Phase 12 test fix (handle stages=null gracefully)

## 9. What Was NOT Changed

- Autonomous testing engine — untouched
- Agent runtime — untouched
- Knowledge system — untouched
- Decision engine — untouched
- Evidence graph — untouched
- Dashboard UI — untouched
- Drytis itself — untouched
