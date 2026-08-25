# BUILD B1 — Integration Contract + Security Boundary

Goal: make QASE safely consumable by a **completely separate application** without touching the QASE UI — authenticate, create a mission, poll/receive results via webhook, retrieve findings/evidence, trigger revalidation. Then freeze the contract and ship a developer package.

Owner decision already recorded (memory `qase_config_authority_decision`): defaults 120/3, ceilings 500/20.

## Workstreams

### W1 — Integration authentication
- New `server/integrationAuth.js`: HMAC-SHA256 signed requests (or HS256 JWT) via `QASE_INTEGRATION_SECRET` (env key already exists in backend env rows, currently zero consumers).
- Identity: integration token → { workspaceId, scopes }. Two principals minimum: admin (full) + integration (mission create/status/result/revalidate).
- `requireIntegrationAuth` middleware for `/api/v1/*` external surface; UI keeps its existing bearer token path.
- Timing-safe comparisons; 401 with stable error envelope.

### W2 — Workspace/project authorization
- Enforce ownership on all mission/finding/evidence/result reads + writes: token's workspaceId must match entity's workspaceId (projectId lookup) → else 403. Cross-workspace test matrix A→A pass, A→B 403, anon 401, expired 401.
- Default project gets a workspaceId on first integration; missions inherit.

### W3 — Close the anonymous read surface
- Audit all ~60 anonymous GETs (index.js + phaseRouter PUBLIC_READ_GET). Gate everything except: `/api/health`, and the session-activity SSE stream used by the logged-in UI (needs token or cookie).
- `/api/artifacts/*` screenshots must require auth.

### W4 — Mission idempotency + correlation IDs
- `POST /api/v1/missions` accepts `Idempotency-Key` header: same key → same mission (200 with existing), no duplicates across restart (persisted index). Scope keys per workspace.
- `X-Correlation-Id` accepted on all `/api/v1` requests, echoed in responses, stamped into mission records + log lines, propagated to webhooks.

### W5 — Webhooks: signed, retried, persisted
- HMAC signature header (`X-Qase-Signature`), timestamp to block replay.
- Retry with backoff (e.g. 5 attempts), delivery log persisted to `.qase/webhook-deliveries.json` (survives restart, P4.4-compatible store registration).
- Events: mission.completed, mission.failed, finding.revalidated. SSRF-validated via targetGuard (already exists).

### W6 — Mission-scoped budget honoring (from B0 finding)
- `POST /api/v1/missions` `context.maxTurns` must reach the agent (agent.js:161 currently reads global settings only). Precedence: mission context (≤ hard ceiling 500) > stored config default 120. Guard: clamp + reject > 500.

### W7 — API contract freeze + developer package
- `docs/openapi.yaml` covering: auth, missions (create/status/report/stop), findings, evidence, revalidation, webhooks, errors, pagination envelope.
- `docs/integration-guide.md` (auth scheme, polling vs webhook, idempotency, correlation, error codes, rate notes), examples dir.
- `docs/reference-client.md` + `examples/reference-client/` — minimal no-dependency Node client: createMission, waitForCompletion, getReport, getFindings, getEvidence, revalidate.

### W8 — Secret hygiene baseline
- Integrate no new plaintext secrets; `QASE_INTEGRATION_SECRET` stays env-only (never echoed, never in GET /api/config).
- BS-pollution guard: the execution-provenance live test that PUTs placeholder BS creds must snapshot BEFORE enabling and restore in finally even across restart (write restore marker to scratch file if needed).

## Acceptance criteria (all must pass)
- [ ] Anonymous request to every protected v1 route → 401; wrong-workspace → 403; matrix tested
- [ ] Same Idempotency-Key creates exactly one mission (incl. across server restart)
- [ ] Correlation ID echoed + stamped into mission + webhook payload
- [ ] Webhook delivery: signed header verifies; failed receiver retried with backoff; delivery record persisted and survives restart
- [ ] Mission with `context.maxTurns: 8` finishes with turn count ≤ 8 (+ small overrun margin only if SDK enforces asynchronously — document if so)
- [ ] External reference client completes the full golden flow against preview URL with NO UI interaction: create → poll status → get report/findings/evidence → revalidate → webhook received (signed)
- [ ] OpenAPI spec validates; examples match live responses
- [ ] Full regression: core suite no new failures; contract suite extended to cover auth
- [ ] Reviewer + tester PASS

## Out of scope (STOP rule)
B2 autonomy wiring (resolveAction, risk loop, enrichment, auto-revalidation trigger), B3 governor/model routing, rate limiting beyond trivial abuse guard (design in OpenAPI, implement later), secrets encryption at rest (separate decision), BrowserStack agent execution, infra changes.
