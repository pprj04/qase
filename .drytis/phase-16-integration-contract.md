# Phase 16 — Drytis Integration Contract

## The Exact API Contract for External Consumers

**Version: 1.0**
**Date: 2026-08-14**

---

## 1. Authentication

### Method: Bearer Token

```
Authorization: Bearer <token>
```

Two accepted token types:
1. **Drytis JWT** (preferred): HS256-signed, 15-min TTL, carries workspaceId/projectId/userId claims
2. **QASE API Token** (legacy): static bearer token for single-user/local mode

### Failure Response

```json
HTTP 401
{
  "error": "Authentication required",
  "detail": "Provide a valid Drytis integration token or QASE API token."
}
```

---

## 2. Create Quality Mission

### Request

```
POST /api/v1/missions
Authorization: Bearer <token>
Content-Type: application/json
X-Correlation-Id: <optional trace ID>

{
  "targetUrl": "http://localhost:9906",        // REQUIRED
  "name": "Quality Check — Build 42",           // optional
  "type": "full_audit",                         // optional: full_audit|security|ux|regression|feature_gap|accessibility
  "buildPrompt": "ContactVault CRM app",        // optional: what the app does
  "requirements": ["auth", "data persistence"], // optional: what to validate
  "workspaceId": "ws-abc123",                   // optional: Drytis workspace ID
  "generationId": "gen-build-42",               // optional: Drytis generation/build ID (enables idempotency)
  "autoStart": true,                            // optional: default true
  "projectId": "proj-123",                      // optional: target project
  "businessGoals": "...",                       // optional
  "targetAudience": "...",                      // optional
  "userRoles": ["admin", "user"],               // optional
  "expectedFeatures": ["login", "dashboard"],   // optional
  "expectedWorkflows": [...],                   // optional
  "testCredentials": {                          // optional: in-memory only, NOT persisted
    "username": "admin",
    "password": "secret"
  }
}
```

### Response (new mission, auto-started)

```json
HTTP 202
{
  "missionId": "d7c54825-aae8-4055-8566-c4a883f3f0a0",
  "sessionId": "07d8d856-...",
  "status": "running",
  "correlationId": "drytis-build-001",
  "message": "Mission started. Poll GET /api/v1/missions/:id for results.",
  "reportUrl": "/api/v1/missions/d7c54825-.../report"
}
```

### Response (idempotent retry)

```json
HTTP 200
{
  "missionId": "d7c54825-aae8-...",
  "sessionId": "07d8d856-...",
  "status": "completed",
  "idempotent": true,
  "correlationId": "drytis-build-001",
  "reportUrl": "/api/v1/missions/d7c54825-.../report"
}
```

### Error Responses

| HTTP | Condition |
|------|-----------|
| 400 | Missing `targetUrl` |
| 401 | Authentication failure |
| 403 | Workspace/project access denied |
| 500 | Agent start failure |

### Idempotency

When BOTH `workspaceId` AND `generationId` are present, repeated requests with the same values + `targetUrl` return the existing mission. No duplicate execution.

### Async Behavior

The HTTP response returns immediately (202). The agent runs asynchronously. Poll `GET /api/v1/missions/:id` for status updates.

---

## 3. Poll Mission Status

### Request

```
GET /api/v1/missions/:id
Authorization: Bearer <token>
```

### Response

```json
{
  "id": "d7c54825-...",
  "status": "running",           // created|queued|running|completed|failed|aborted|cancelled|timeout
  "type": "full_audit",
  "targetUrl": "http://localhost:9906",
  "qualityScore": null,          // null while running, number when complete
  "verdict": null,               // null while running, "pass"|"fail"|"pass_with_issues"|"blocked"
  "releaseReady": null,
  "findingsCount": 3,
  "findings": [...],             // array of finding objects
  "sessionId": "07d8d856-...",
  "pipelineStages": null,        // { stageName: "done"|"failed"|"skipped" } or null
  "currentStage": "exploring",   // pending|exploring|completed|failed|aborted
  "currentIteration": 0,
  "iterations": [],
  "stopReason": null,
  "constraints": {},
  "correlationId": "drytis-build-001",
  "workspaceId": "ws-drytis-sim",
  "projectId": null,
  "generationId": "gen-drytis-build-001",
  "createdAt": 1786680301000,
  "startedAt": 1786680301000,
  "updatedAt": 1786680600000,
  "completedAt": null,           // null while running
  "elapsedMs": 300000,
  "queueMs": 0,
  "estimatedDuration": 300000,
  "estimatedTimeRemaining": 0
}
```

### Status Values

| Status | Meaning | Terminal? |
|--------|---------|-----------|
| `created` | Mission created, not started | No |
| `queued` | Waiting for worker | No |
| `running` | Agent executing | No |
| `completed` | Finished successfully | Yes |
| `failed` | Execution failed | Yes |
| `aborted` | Stopped by user | Yes |
| `cancelled` | Cancelled by system | Yes |
| `timeout` | Exceeded time limit | Yes |

---

## 4. Retrieve Final Report

### Request

```
GET /api/v1/missions/:id/report
Authorization: Bearer <token>
```

Optional: `?format=markdown` or `?format=json` (default: json)

### Response (JSON)

```json
{
  "missionId": "d7c54825-...",
  "status": "completed",
  "verdict": "fail",
  "qualityScore": 15,
  "releaseReady": false,
  "targetUrl": "http://localhost:9906",
  "findings": [
    {
      "id": "...",
      "title": "Created contacts are lost on page reload",
      "severity": "critical",
      "category": "data",
      "url": "http://localhost:9906/",
      "steps": [...],
      "expected": "...",
      "actual": "...",
      "evidence": "...",
      "confidence": 0.85,
      "reproducibility": "confirmed"
    }
  ],
  "recommendations": [...],
  "improvementPrompt": "...",
  "decision": {
    "decision": "STOP_PASS",
    "confidence": 0.6,
    "reason": "..."
  },
  "stopReason": "failed",
  "createdAt": ...,
  "startedAt": ...,
  "completedAt": ...,
  "elapsedMs": 425997
}
```

---

## 5. Retrieve Evidence

```
GET /api/v1/missions/:id/evidence?limit=50&offset=0
Authorization: Bearer <token>
```

Returns `{ evidence: [...], totalEvidence, limit, offset }`.

Evidence types: `step_outcome` (browser actions), `console` (console errors), `finding_detail` (finding-specific evidence).

---

## 6. Webhook Registration

### Register

```
POST /api/v1/webhooks
Authorization: Bearer <token>
Content-Type: application/json

{
  "missionId": "d7c54825-...",
  "url": "https://drytis.example.com/api/qase-callback",
  "events": ["mission.completed"]
}
```

Response: `201 { webhookId, secret, signatureHeader: "X-Qase-Signature" }`

### Webhook Delivery

When the mission completes, QASE POSTs to the registered URL:

```json
{
  "event": "mission.completed",
  "missionId": "d7c54825-...",
  "status": "completed",
  "verdict": "fail",
  "qualityScore": 15,
  "releaseReady": false,
  "findingsCount": 3,
  "correlationId": "drytis-build-001",
  "completedAt": 1786680727929,
  "reportUrl": "/api/v1/missions/d7c54825-.../report"
}
```

Headers:
- `X-Qase-Signature: sha256=<HMAC>` — verify with the webhook secret
- `X-Qase-Webhook-Id: <webhookId>`
- `X-Qase-Attempt: 1` (increments on retry)

Retry: 3 retries on 5xx/timeout/connection error. No retry on 4xx. Backoff: 2s → 4s → 8s.

### Delivery Log

```
GET /api/v1/webhooks/:webhookId/delivery
```

Returns `{ webhookId, deliveries: [{ attempt, status, timestamp, httpStatus }] }`.

---

## 7. List Missions

```
GET /api/v1/missions?limit=50&offset=0&status=completed&projectId=...&generationId=...
Authorization: Bearer <token>
```

Returns `{ missions: [...], total, limit, offset }`.

---

## 8. Stop / Revalidate

### Stop

```
POST /api/v1/missions/:id/stop
Authorization: Bearer <token>
```

Returns `200 { aborted: true }`. Mission transitions to `aborted`.

### Revalidate

```
POST /api/v1/missions/:id/revalidate
Authorization: Bearer <token>
```

Starts a new validation iteration. Returns `202 { iteration, message }`.

---

## 9. Security Boundary

| Check | Mechanism |
|-------|-----------|
| Authentication required | `requireIntegrationAuth` on all v1 routes |
| Workspace isolation | JWT callers: `authorizeWorkspace()` checks `identity.workspaceId === resource.workspaceId` |
| Project isolation | JWT callers: `authorizeProject()` checks workspace + projectId match |
| Mission ownership | `authorizeMissionAccess()` resolves workspace/project chain |
| Session ownership | `authorizeSessionAccess()` follows same rules |
| SSRF protection | Webhook URL blocked if hostname matches internal IP patterns |
| Test credentials | In-memory vault only, never persisted to JSON |
| Token timing | `timingSafeEqual` for API token comparison |

### Legacy API Token Note

Callers using the static API token (no JWT) are treated as internal/admin with full access. Workspace isolation applies ONLY to JWT-authenticated callers. For production Drytis integration, JWT auth should be used.

---

## 10. Recommended Drytis Integration Flow

```
1. Drytis build completes
2. Drytis generates JWT with { userId, workspaceId, projectId }
3. POST /api/v1/missions
   Body: { targetUrl, generationId, buildPrompt, requirements, workspaceId, autoStart: true }
   Header: X-Correlation-Id: <drytis-build-id>
4. Receive 202 { missionId, sessionId, status: "running" }
5. Option A: Poll GET /api/v1/missions/:id every 10-30s until terminal status
   Option B: POST /api/v1/webhooks to register completion callback
6. On completion:
   GET /api/v1/missions/:id/report → full result
   GET /api/v1/missions/:id/evidence → evidence data
7. Drytis stores { missionId, qualityScore, verdict, releaseReady } for the build
```

### Retry Behavior

If Drytis loses track of a mission (e.g., network timeout after step 4):
- Retry POST /api/v1/missions with same workspaceId + generationId + targetUrl
- Returns the existing mission (idempotent) — no duplicate execution
- Then poll for status

---

## 11. Drytis-Facing Result Model

The canonical result object Drytis should consume:

```json
{
  "missionId": "string",
  "sessionId": "string",
  "status": "completed|failed|aborted",
  "qualityScore": 0-100,
  "releaseReadiness": "ready|blocked",
  "verdict": "pass|fail|pass_with_issues|blocked",
  "confidence": 0.0-1.0,
  "findings": [
    {
      "id": "string",
      "title": "string",
      "severity": "critical|high|medium|low|info",
      "category": "string",
      "url": "string",
      "steps": ["string"],
      "expected": "string",
      "actual": "string",
      "evidence": "string",
      "confidence": 0.0-1.0,
      "reproducibility": "confirmed|probable|uncertain"
    }
  ],
  "evidence": {
    "totalEvidence": "number",
    "coverage": { "verified": "number", "partial": "number", "unverified": "number" }
  },
  "decision": {
    "decision": "CONTINUE|REVALIDATE|ESCALATE|STOP_PASS|STOP_FAIL",
    "confidence": 0.0-1.0,
    "reason": "string"
  },
  "recommendations": ["string"],
  "report": "full report object from GET /report"
}
```

### Field Sources

| Field | QASE Source |
|-------|-------------|
| missionId | `mission.id` |
| sessionId | `mission.sessionId` |
| status | `mission.status` |
| qualityScore | `mission.qualityScore` |
| releaseReadiness | `mission.releaseReady` (true/false → ready/blocked) |
| verdict | `mission.verdict` |
| confidence | `session.pipeline.summary.confidence` |
| findings | `mission.findings[]` |
| evidence | `GET /missions/:id/evidence` + `/evidence-coverage` |
| decision | `session.decisionHistory` or `session.pipeline.summary.decision` |
| recommendations | `report.recommendations` |
| report | `GET /missions/:id/report` |
