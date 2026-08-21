# Next Build — Audit: Autonomous Worker + Complete Result Delivery

**Date:** 2026-08-12
**Status:** COMPLETE — audit finished before any implementation

---

## ALREADY WORKING

| # | Capability | Evidence | Quality |
|---|-----------|----------|---------|
| 1 | **API assignment contract** | `POST /api/v1/missions` (index.js:1535) — accepts targetUrl, projectId, generationId, objectives, requirements, context, constraints, autoStart. Returns 202 immediately with {missionId, sessionId, status, correlationId, reportUrl}. | ✅ Complete |
| 2 | **Immediate response** | Agent starts via `startTurn()` (fire-and-forget), response sent with 202 before agent completes. HTTP request is not held open. | ✅ Complete |
| 3 | **Background worker independence** | Agent runs independently via CleanSlate SDK `startTurn()`. The HTTP response is already sent (202) before execution finishes. Worker continues after client disconnects. | ✅ Complete |
| 4 | **Mission lifecycle** | `MISSION_STATUS = ['created', 'running', 'completed', 'failed', 'aborted']` (missions.js:30). Terminal guards prevent double-finalization. | ✅ Complete |
| 5 | **Status API** | `GET /api/v1/missions/:id` (index.js:1762) — returns status, qualityScore, verdict, releaseReady, findings, iterations, pipelineStages, createdAt, completedAt. Triggers lazy finalization. | ✅ Complete (missing timing fields) |
| 6 | **Report API** | `GET /api/v1/missions/:id/report` (index.js:2093) — full result with missionId, projectId, generationId, status, verdict, qualityScore, releaseReady, decision, findings, recommendations, improvementPrompt, iterations, stopReason, timing. | ✅ Complete |
| 7 | **Autonomous pipeline** | autoStart=true → createSession → ensureRuntime → startTurn → agent explores → browser → findings → evidence → quality → decision → finalization | ✅ Complete |
| 8 | **Application understanding** | `server/appUnderstanding.js`, `server/domainUnderstanding.js`, `server/intentModel.js` — domain classification, feature detection, intent analysis | ✅ Complete |
| 9 | **Agent execution** | `server/agent.js` — CleanSlate SDK integration, 21 tools, reasoning, browser interaction | ✅ Complete |
| 10 | **Browser execution** | `server/browserBridge.js` — Playwright, timeout protection, recovery after 3 failures | ✅ Complete |
| 11 | **Evidence graph** | `server/evidenceGraph.js` — 12 evidence types, 14 edge types, evidence collection during finalization | ✅ Complete |
| 12 | **Findings generation** | Agent generates findings via LLM, stored on session + mission, deduplicated via Phase 8 | ✅ Complete |
| 13 | **Quality assessment** | `calculateMissionQuality()` in missions.js — scoring, verdict, releaseReady, recommendations | ✅ Complete |
| 14 | **Decision engine** | `server/decisionEngine.js` — 8 decision types, runs during finalization | ✅ Complete |
| 15 | **Validation loop** | `server/validationLoop.js` — REVALIDATE, convergence, iteration management | ✅ Complete |
| 16 | **Background finalizer** | 30s interval (index.js:3141) — finds stuck missions, finalizes from session state | ✅ Complete |
| 17 | **Resource cleanup** | 60s interval (index.js:3197) — closes zombie Chrome processes, prunes old sessions | ✅ Complete |
| 18 | **Idempotency** | `workspaceId:generationId:targetUrl` composite key (index.js:1550). `findByIdempotencyKey()` in missions.js | ✅ Complete |
| 19 | **Correlation tracking** | X-Correlation-Id middleware (index.js), stored on mission, echoed in responses | ✅ Complete |
| 20 | **JWT authentication** | `server/integrationAuth.js` — HS256 verify, expiry, identity extraction | ✅ Complete |
| 21 | **Authorization** | `server/authorization.js` — workspace, project, mission, session ownership checks | ✅ Complete |
| 22 | **Standalone operation** | No Drytis dependency in core modules. API token works without JWT. | ✅ Complete |
| 23 | **External client fixture** | `tests/fixtures/external-client/qase-client.js` — generic integration client | ✅ Complete |
| 24 | **Secrets vault** | `server/secrets.js` — placeholder substitution, redaction, never persisted | ✅ Complete |

## NEEDS FIX

| # | Gap | Impact | Fix Plan |
|---|-----|--------|----------|
| 1 | **No execution timing in status API** | Status response missing startedAt, updatedAt, elapsedTime, estimatedDuration, progress, currentStage | Add timing fields to `GET /api/v1/missions/:id` response |
| 2 | **No execution timing in mission model** | Mission lacks `startedAt` field (only `createdAt` and `completedAt`) | Add `startedAt` to mission creation/update flow |
| 3 | **No historical runtime estimation** | No mechanism to estimate mission duration from past runs | Add `estimateDuration()` using historical missions data |
| 4 | **Webhook payload is full report** | `fireMissionWebhooks()` sends entire report object spread into body (index.js:3057) — too heavy for a notification | Change to lean notification payload + reportUrl |
| 5 | **No webhook retry** | Webhook `fetch().catch(() => {})` — fire-and-forget, no retry on failure (index.js:3058) | Add retry with exponential backoff (3 attempts) |
| 6 | **No webhook delivery tracking** | No record of delivery attempts, success/failure status | Add delivery log per webhook |
| 7 | **No webhook signature** | No HMAC signature to verify webhook authenticity | Add X-Qase-Signature header |
| 8 | **Missing 'cancelled' and 'timeout' statuses** | Thomas asked for cancelled/timeout states. Currently uses 'aborted' for manual stop, no explicit timeout status | Add 'cancelled' and 'timeout' to MISSION_STATUS |
| 9 | **No queue tracking** | No queue time tracking — missions go from 'created' directly to 'running' | Add queue time = startedAt - createdAt |

## NEEDS TESTING

| # | Item | Plan |
|---|------|------|
| 1 | Client disconnect mid-execution | Create mission via API, immediately close connection, verify mission completes |
| 2 | Webhook successful delivery | Register webhook + mock receiver, verify delivery on mission completion |
| 3 | Webhook failed delivery + retry | Mock receiver returns 500, verify retry attempts |
| 4 | Webhook failure isolation | Verify mission completes even if webhook endpoint is down |
| 5 | Result retrievable after webhook failure | Verify GET report works even when webhook fails |
| 6 | Estimated duration accuracy | Compare estimates vs actuals for completed missions |
| 7 | Server restart recovery | Mission in 'running' when server restarts → should be finalized/cleaned |
| 8 | Worker interruption recovery | Session interrupted → mission finalized via background finalizer |
| 9 | Duplicate concurrent requests | Two identical requests simultaneously → only one mission |
| 10 | Full autonomous E2E | Real mission through API → agent → browser → findings → evidence → completion |

## MISSING

| # | Item | Impact | Plan |
|---|------|--------|------|
| 1 | Lean webhook notification payload | Webhooks currently send full report | Change to {event, missionId, projectId, generationId, status, verdict, qualityScore, correlationId, completedAt, reportUrl} |
| 2 | Webhook retry mechanism | Failures are silent | Add 3 retries with backoff, delivery log |
| 3 | Webhook HMAC signature | Can't verify authenticity | Add X-Qase-Signature using integration secret |
| 4 | Execution timing system | No startedAt, elapsed, estimated | Add fields + computation |
| 5 | Estimated duration from history | Thomas asked for this | Compute from completed missions of same type |
| 6 | 'queued' status | No queue concept | Add 'queued' between 'created' and 'running' |
| 7 | Webhook delivery test coverage | No tests for webhook scenarios | 10 webhook reliability tests |

## OUT OF SCOPE

| Item | Reason |
|------|--------|
| Drytis-side integration implementation | Drytis dev team owns this |
| Drytis JWT issuance | Drytis dev team owns this |
| AI Studio UI changes | Drytis dev team owns this |
| Database migration | Not required |
| Distributed browser infrastructure | Later phase |
| Closed-loop Build 1 → Build 2 validation | Phase 12 territory |
| New AI intelligence | Unrelated to worker execution |
| Redesigning QASE core architecture | Explicitly forbidden |

---

## Architecture Summary

```
External Consumer (Drytis / AI Studio / future client)
    │
    ├── POST /api/v1/missions {targetUrl, generationId, projectId, ...}
    │       → 202 {missionId, status:"running", correlationId, reportUrl}
    │
    ├── Worker starts independently (CleanSlate SDK startTurn)
    │
    ├── GET /api/v1/missions/:id (poll status)
    │       → {status, qualityScore, verdict, findings, timing, ...}
    │
    ├── POST /api/v1/webhooks {missionId, url, events}
    │       → 201 {webhookId}
    │
    └── GET /api/v1/missions/:id/report (final result)
            → {missionId, verdict, qualityScore, findings, evidence, ...}
```

**Key finding:** The core worker architecture is solid. The API already returns immediately (202), the worker runs independently, and the mission lifecycle is well-managed. The main gaps are:

1. **Execution timing** — need startedAt, elapsed, estimated
2. **Webhook improvements** — lean payload, retry, signature, delivery tracking
3. **Status enrichment** — add timing + stage info to status response
4. **Lifecycle completeness** — add 'queued', 'cancelled', 'timeout' states
