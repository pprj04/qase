# Phase 11 — QASE Integration Contract

**Version:** 1.0
**Date:** 2026-08-12

This document defines the generic external-client contract for consuming QASE.
It is NOT Drytis-specific — any external application (Drytis, AI Studio, CI/CD,
or future consumers) uses the same contract.

---

## Authentication

External consumers must provide one of:
1. **JWT**: `Authorization: Bearer <jwt>` — HS256-signed, issued by the trusted identity provider (Drytis for Drytis integrations). Claims: `sub` (userId), `workspaceId`, `projectId` (optional), `roles` (optional), `exp`.
2. **API Token**: `Authorization: Bearer <api-token>` — the static `QASE_API_TOKEN`. For single-user/CI-CD usage.

Optional: `X-Correlation-Id` header — if provided, QASE threads it through the entire mission lifecycle. If absent, QASE auto-generates one.

---

## 1. Create Mission

```
POST /api/v1/missions
```

**Request body:**
```json
{
  "targetUrl": "http://example.com",           // REQUIRED
  "projectId": "uuid",                          // Optional — resolves server-side
  "generationId": "gen-123",                    // Optional — used for idempotency
  "type": "full_audit",                         // Optional — default: full_audit
  "name": "Mission name",                       // Optional
  "objectives": ["test login", "test forms"],   // Optional
  "constraints": { "maxIterations": 3 },        // Optional
  "autoStart": true,                            // Optional — default: true
  "buildPrompt": "A contact management app",    // Optional — context
  "requirements": ["user auth", "data export"], // Optional — explicit expectations
  "businessGoals": "Increase conversion",       // Optional
  "testCredentials": {                           // Optional — never returned
    "username": "admin",
    "password": "secret123"
  }
}
```

**Response (201 Created):**
```json
{
  "missionId": "uuid",
  "sessionId": "uuid",
  "status": "running",
  "correlationId": "uuid",
  "reportUrl": "/api/v1/missions/uuid/report"
}
```

**Response (201 Created, autoStart=false):**
```json
{
  "missionId": "uuid",
  "status": "created",
  "correlationId": "uuid"
}
```

**Response (200 OK — idempotent match):**
```json
{
  "missionId": "uuid",
  "sessionId": "uuid",
  "status": "running",
  "correlationId": "uuid",
  "idempotent": true,
  "reportUrl": "/api/v1/missions/uuid/report"
}
```

**Idempotency:** If `workspaceId` + `generationId` + `targetUrl` match an existing mission, returns 200 with the existing mission instead of creating a duplicate.

---

## 2. Track Mission Status

```
GET /api/v1/missions/:missionId
```

**Response (200):**
```json
{
  "id": "uuid",
  "status": "created | running | completed | failed | aborted",
  "type": "full_audit",
  "targetUrl": "http://...",
  "qualityScore": 85,          // null until completed
  "verdict": "pass",            // null until completed
  "releaseReady": true,         // null until completed
  "findingsCount": 3,
  "findings": [...],            // full array
  "sessionId": "uuid",
  "currentIteration": 1,
  "iterations": [...],
  "iterationMetadata": [...],
  "stopReason": "approved",
  "createdAt": 1234567890,
  "completedAt": 1234567891
}
```

**Polling:** The external client polls this endpoint until `status` is terminal (`completed`, `failed`, `aborted`). QASE also finalizes the mission lazily when polled.

---

## 3. Get Final Report

```
GET /api/v1/missions/:missionId/report
GET /api/v1/missions/:missionId/report?format=markdown
```

**Response (200 JSON):**
```json
{
  "missionId": "uuid",
  "projectId": "uuid",
  "generationId": "gen-123",
  "correlationId": "uuid",
  "workspaceId": "ws-001",
  "status": "completed",
  "missionType": "full_audit",
  "targetUrl": "http://...",
  "source": "integration",
  "verdict": "pass | pass_with_issues | fail",
  "qualityScore": 85,
  "releaseReady": true,
  "decision": "STOP_PASS",
  "findings": [
    {
      "title": "...",
      "severity": "critical | high | medium | low | info",
      "category": "...",
      "observed": "...",
      "expected": "...",
      "impact": "...",
      "evidence": "...",
      "recommendation": "...",
      "fixPrompt": "...",
      "confidence": 0.8,
      "reproducibility": "confirmed | unconfirmed"
    }
  ],
  "recommendations": ["Fix X", "Improve Y"],
  "improvementPrompt": "# Improvement Request...",
  "createdAt": 1234567890,
  "completedAt": 1234567891
}
```

---

## 4. Stop Mission

```
POST /api/v1/missions/:missionId/stop
```

Aborts a running mission. Returns the aborted mission.

---

## 5. Register Webhook

```
POST /api/v1/webhooks
```

**Request:**
```json
{
  "missionId": "uuid",
  "url": "https://external-app.com/webhook",
  "events": ["mission.completed"]
}
```

QASE fires the webhook when the mission completes. Payload is the full report object.

---

## 6. Get Evidence

```
GET /api/v1/missions/:missionId/evidence
GET /api/v1/missions/:missionId/evidence?limit=100&offset=0
```

Returns evidence items for the mission with pagination.

---

## 7. Get Iteration Comparison

```
GET /api/v1/missions/:missionId/comparison
```

Returns comparison between the last two iterations (for multi-iteration missions).

---

## Async Execution Model

1. Client calls `POST /api/v1/missions` → receives `missionId` immediately (HTTP 202)
2. QASE executes autonomously — agent, browser, evidence collection, findings, quality, decision
3. Client polls `GET /api/v1/missions/:id` until terminal status
4. Client retrieves final report via `GET /api/v1/missions/:id/report`
5. Alternatively, client registers a webhook and receives the report on completion

The client can disconnect after step 1 and reconnect later — the mission continues independently.

---

## QASE-OWNED vs DRYTIS-OWNED

**QASE owns:**
- Core engine (agent, browser, evidence, findings, quality, decision, validation)
- API endpoints (creation, status, report, evidence, webhooks)
- Authentication boundary (JWT verification, API token)
- Authorization boundary (workspace scoping, ownership checks)
- Mission lifecycle (creation, execution, finalization)
- Result contract (report format, field definitions)
- Idempotency and correlation

**Drytis development team owns:**
- JWT issuance using the shared `QASE_INTEGRATION_SECRET`
- Calling the QASE API from AI Studio
- Drytis-side user experience and UI
- Production configuration on the Drytis side
