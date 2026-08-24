# M1-P3 — EXECUTION LIFECYCLE CONTRACT (Phase 2)

Canonical lifecycle as **implemented today** (main @ 4eb617c). Nothing invented; every
stage marked EXISTING / PARTIAL / MISSING / PLANNED. This is the contract the team builds
against until M1-P4+ changes it.

```
REQUEST → MISSION → PLAN → EXECUTION → EVIDENCE → FINDING → VALIDATION → FINAL VERDICT → REPORT
```

## Stage table

| Stage | Input | Output | Owner (file) | Persistence | Failure behavior | Retry | Idempotency | API exposure | Evidence requirements | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| **REQUEST** | `{targetUrl, missionType?, device?, testCredentials?, autoStart?, projectId?}` | 202 `{missionId, sessionId, status:'running', reportUrl}` or 201 (autoStart:false) | index.js:1565-1687 | mission row (missions.json, atomic 500 ms) | 400 invalid URL/device; 500 + mission marked `failed` if session can't start | none at API layer (client may re-POST; **create-time idempotency check MISSING** — idempotencyKey stored but unchecked) | PARTIAL | POST /api/v1/missions | device validated pre-create (400); targetUrl host NOT validated (SSRF, deferred) | **PARTIAL** (idempotency MISSING) |
| **MISSION** | created mission + session | mission running, session linked | missions.js:102-161, index.js:1617-1635 | missions.json | vault migration failure → 500, mission failed | — | updateMission allowlisted patch | GET /api/v1/missions/:id (lazy finalize), /api/missions | — | **EXISTING** (restart recovery was MISSING → fixed this build: boot sweep marks orphaned running → interrupted) |
| **PLAN** | session + knowledge hints + buildMissionPrompt | taskPrompt; agent decides steps live | index.js:1641-1656, 2362-2393 | session.knowledgeHints/knowledgePatternsUsed (sessions.json) | knowledge injection is best-effort (catch) | — | — | none (internal) | — | **PARTIAL** (plan is emergent in-agent, not a persisted artifact; deliberate for agentic model) |
| **EXECUTION** | taskPrompt + QA tools + device context | browser actions, capturedSteps, SSE stream | agent.js:313-610, browserBridge.js, workflows.js:136-245 | session.capturedSteps (sessions.json) + SSE ephemeral frames | per-turn abort; retryable model-timeout ×2 (agent.js:687-690); turn timeout 20 min; store watchdog → interrupted | agent-level only | runTurn rejects concurrent runs per session (agent.js:316-319) | SSE GET /api/sessions/:id/events (open) | every browser tool → captureStep with independent step outcome (urlAfter/titleAfter/console/network) | **EXISTING** (agent screenshots NOT persisted — SSE-only, documented honesty) |
| **EVIDENCE** | capturedSteps + findings at finalize | STEP_OUTCOME / FINDING_DETAIL / observation nodes + SUPPORTED_BY / CORRELATES_WITH edges | evidenceGraph.js:1004-1107 | evidence-graph.json (**now atomic + loud-load**) | collect is best-effort at finalize | — | node ids UUID | GET /api/v1/evidence/mission/:id (paginated), /session/:id | ≥2 evidence from ≥2 sources required for lifecycle VERIFIED (findings.js) | **EXISTING** (pagination total bug fixed this build) |
| **FINDING** | report_finding tool call | 38-key finding, deduped | qaTools.js:21-128, findings.js:214-283, 618-676; findingIntelligence.js:575-630 | findings.json (atomic, loud-load) | severity clamped; confidence never caller-trusted; status transitions only via validated endpoints | — | syncSessionFinding update-by-id-or-create; live dedup jaccard 0.90/0.62 + error-signature corroboration | GET /api/findings, /api/v1/findings/*, PATCH status (**now auth'd**), review endpoints | typed evidence required for SECURITY/AUTH lifecycle gates | **EXISTING** |
| **VALIDATION** | POST /api/v1/findings/:id/revalidate (Idempotency-Key) | validation run → deterministic fixStatus | phaseRouter.js:385-406, fixValidation.js:94-236, validationExecutorCore.js:225-388, fixStatusEngine.js:231-292 | fix-validations.json (**now atomic**; FIFO 500; **boot sweep now reaps stuck runs**) | 409 if active run; immutable originalFinding snapshot; classify deterministic | VALIDATION_ATTEMPTS=2 (env) | Idempotency-Key honored; MIN_VERIFIED_ATTEMPTS=2 for VERIFIED_FIXED | POST …/revalidate, GET …/validations, approve/reopen | before/after replay evidence recorded to graph; insufficient → UNABLE_TO_VERIFY | **EXISTING** (stuck-run reaper was MISSING → fixed this build) |
| **FINAL VERDICT** | session complete + findings | mission verdict pass / pass_with_issues / fail, qualityScore, releaseReady | devIntelligence.js:267-379 (calculateMissionQuality — deterministic), index.js:2409-2530 (honesty guard), capabilities.js:476-539 | missions.json | **error/interrupted session ⇒ forced failed, no score, no findings surfaced** (index.js:2415-2431) | — | finalizeMission terminal no-op; recordIteration sessionId-deduped | GET /api/v1/missions/:id (lazy finalize on poll) | verdict must be supported by evidence counts fed to calculateMissionQuality; LLM-reported pass cannot survive interrupted/error session | **EXISTING** |
| **REPORT** | finalized mission | JSON report / markdown (incl. APPLICATION QUALITY) | index.js:2126-2153, 2566-2632 | generated on demand (mission row holds summary) | 404 unknown; watchdog fallback report documented | — | — | GET /api/v1/missions/:id/report?format=json|md | report reflects deterministic quality + findings arrays | **EXISTING** |

## Cross-stage invariants (must never break — M1-P2 protected suite territory)

1. No path may surface an interrupted/error session as pass/scored (honesty guard).
2. fixStatus derivation is deterministic; LLM never selects it; VERIFIED_FIXED requires ≥2 attempts + expected-observed + sufficient evidence.
3. REAL_DEVICE requires provider=browserstack ∧ device ∧ ¬engineEmulated; strict mode never silently falls back to local.
4. Finding lifecycle/review/confidence never caller-supplied.
5. Dedup requires text similarity AND error-signature corroboration.

## Known gaps carried forward

- PLAN is not a persisted artifact (agentic emergent) — PLANNED to stay.
- REQUEST idempotency at create: MISSING → M1-P4.
- Agent screenshots not persisted (SSE-only): documented product decision (Build 4 honesty banner in UI).
- Evidence retention unbounded; artifacts 217 MB unpruned → M1-P4.
