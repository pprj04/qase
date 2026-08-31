# QASE — Architecture (as built, C3 @ 2a22a74)

Verified from source 2026-08-29. One Node ≥20 process, ES modules, Express 5, no framework frontend.

## Process & middleware (registration order, `server/index.js`)

1. `express.json({limit:'1mb', verify})` — captures **raw body** for HMAC signing (`index.js:135`)
2. `setAuthCookie` — refresh-only; never grants the cookie to anonymous visitors (B1/M1 hardening, `index.js:141`)
3. `correlationIdMiddleware` — `X-Correlation-Id` generate/validate/echo + `request.log` (`index.js:142`)
4. `express.static(public)` — SPA (`index.js:143`)
5. `GET /api/artifacts/:runId/:filename` — traversal-guarded artifact server (`index.js:147`)
6. `/demo` — deliberately-buggy practice site, **no auth** (`demoSite.js`, `index.js:165`)
7. `app.use('/api', phaseRouter(requireApiToken, []))` — phase/legacy API; its gate exempts only `/v1/integration/*` and `/v2/*` (`index.js:1559`, `phaseRouter.js:86`)
8. `app.use('/api/v2', pulseV2Router(requireApiToken, apiUsageCounter()))` — Pulse read API; `/health` public inside factory (`index.js:1569`)
9. `GET /openapi.json` — public, `Cache-Control: no-store`, `QASE_PUBLIC_URL`-aware (`index.js:1571`)

**No CORS middleware exists** — single-origin posture. **No rate limiter.**

## Route map (verified from source)

### Public (no auth)
| Method | Route | Purpose | Source |
|---|---|---|---|
| GET | `/api/health` | liveness + uptime | index.js:228 |
| GET | `/api/v2/health` | Pulse liveness | pulseV2Router.js:55 |
| GET | `/openapi.json` | OpenAPI 3.1 doc | index.js:1571 |
| * | `/demo/*` | practice target | demoSite.js |

### Token-gated legacy surface (`requireApiToken` — Bearer/cookie/`?token=`)
Sessions & agent control (`index.js:507–805`): sessions CRUD, `/message` (turn start), `/answer`, `/credentials` (secret vault), `/stop`, `/detail`, `/report.md`, `/run-pipeline`, `/pipeline-status`, SSE `/events`, `analyze-dev`, `app-understanding(+summary)`, `feature-gaps`, `dev-intelligence`.
Findings & knowledge (`index.js:818–1511`, `2020–2216`): knowledge CRUD/decay/mission-scoped, findings CRUD/status/comments/testcase-links, `/stats`, `/export` (md·github·jira·linear), per-finding `dev-analysis`/`fix-prompt`, session `export/findings`.
Workflows & test cases (`index.js:985–1366`): workflow CRUD + capture + `/generate-tests`, test-case CRUD/clone/tags/export(run) + `/run` + `/runs` + baselines (capture/approve/delete).
Ops (`index.js:1373–1505`): schedules CRUD + `/run` + `/runs`, `validate-cron`, regression `trend`/`runs`/`runs/:id`, `metrics/dashboard`, projects CRUD, `config` GET/PUT + `/test` (LLM probe) + `/test-browserstack`.
Config & fixtures: `config`/`config/test`/`config/test-browserstack` (`index.js:433–505`); `test-support/*` fixture factories (`index.js:1242/1272`).

### `/api/v1/*` mission/evidence/diagnostics (token-gated)
Missions lifecycle (`index.js:2362–3290`): create (idempotency-key, SSRF-validate, maxTurns clamp 1–500, autoStart via governor), `/start`, `/stop` (queued→cancel vs running→abort), `/iterate`, `/revalidate` (turn-pool budget), `/decision-trace`, `/loop-status`, `/validation-comparison`, `/report` (json·md), `/link-session`, legacy mission CRUD (`index.js:1525, 2221–2293`).
Evidence graph (`index.js:3328–3576`): mission evidence, coverage, integrity, evidence-chain per finding, iterations, compare, `/api/v1/evidence/stats|:id|validate`, session `observations`/`evidence`.
Diagnostics (`index.js:3416–3482`): `state-integrity` (read-only), `store-hygiene(/cleanup)`, `artifacts/orphans|/cleanup` — mutations need `{apply:true}`.
Webhooks: legacy per-mission registration (`index.js:3598`).

### `/api/v1/integration/*` (HMAC-signed, scoped)
`whoami`, `keys` (admin-only register/list; admin bootstrapped from `QASE_ADMIN_KEY_ID`), `missions` create (workspace idempotency + sha256 fingerprint), mission reads (`:id`, report, decision-trace, findings 3-source merge, evidence), `missions/:id/stop|start|revalidate`, `findings/:id/revalidate` + `/validation`, workspace webhook subscriptions (`index.js:1601–2014`).

### `/api` phaseRouter additions (`phaseRouter.js`)
Bug intelligence enums/metrics; finding classification PATCHes (severity/priority/lifecycle/review); duplicates show/mark; related (similarity >0.3); affected-workflow/feature; redacted finding evidence; grouped findings; mission-for-session reverse lookup; ux-quality snapshot; `v1/missions/:id/ux-assess` (202+async); phase-17 reads (quality/ux/feature-gaps/recommendations); ux issue review PATCH; `v1/metrics/ux`; findings revalidate (phase-16 and phase-18 fix-validation with pollUrl); approve/reopen; `v1/fix-validations` list; `v1/missions` envelope + governorStats; `metrics/dashboard/ux`.

### `/api/v2/*` Pulse read surface (token-gated, enveloped `{data,total,page,page_size}`, snake_case, ISO dates; `/health` public)
`bug-taxonomy`; `projects` (bare array); `missions`, `missions/:id`, `mission-summaries`, `mission-status/:id`; `sessions`, `sessions/:id`; `findings`(+stats/grouped/:id with rich filters); `test-cases`(+tags/:id); `workflows`(:id); `suites`; `schedules`(:id/runs); `regression/runs`(:id)/`trend`; `fix-validations`; `findings/:id/validation`; `knowledge`(:id); `metrics/dashboard`, `metrics/ux`; `usage/summary`; `metrics/api-usage`. (`pulseV2Router.js:55–437`)

## Component map (responsibilities verified per file)

| Component | Responsibility | Key exports | Used by |
|---|---|---|---|
| `agent.js` | Agent runtime over `@cleanslate/sdk`: per-session workspace, tool allowlist, 20-min turn wall clock, 5-min model-idle watchdog, **hard turn-budget abort**, deterministic turn-limited close-out. No direct LLM HTTP. | ensureRuntime, runTurn, closeBrowser, finalizeTurnLimitedRun | index |
| `prompt.js` | Per-turn operating brief (target, credential placeholders, findings-so-far, risk guidance) | buildQaContext | agent |
| `qaTools.js` | The 2 bespoke SDK tools: `report_finding`, `finish_qa_report`; secret redaction; autonomy-pipeline hook | createQaTools | agent |
| `secrets.js` | Session secret vault; agent sees `{{PLACEHOLDER}}`s; redactor scrubs leaks | vaultFor, storeSecrets, resolveSecrets, redact | index, agent, qaTools, browserBridge |
| `browserBridge.js` | Watchable cursor/target overlay; placeholder resolution to keyboard | attachBrowserBridge | agent |
| `decisionEngine.js` | **Deterministic** CONTINUE/REVALIDATE/REPLAN/STOP cascade; budgets, idempotency, safety override. No LLM. | makeDecision(Safe), collectDecisionInput, trackBudget | autonomyController, midSessionProbe, validationLoop, capabilities, index |
| `decisionTraces.js` | 13-field audit records; no prompts/content; bounded JSON store | recordDecisionTrace, getDecisionTraces | autonomyController, midSessionProbe, index |
| `autonomyController.js` | B2 loop wiring: state→understanding→context→decision→resolveAction→safety/budget→execution→trace. **Never raises maxTurns** (source-tested). | registerAutonomyHooks, runAutonomy* | index |
| `autonomyBridge.js` | Gate seam between capabilities pipeline and autonomy gate (no-op if unregistered; budget asymmetry preserved) | registerCapabilitiesAutonomyGate | capabilities, index |
| `autonomyContext.js` | Builds `session.testContext` from intent/knowledge/auth-need | buildTestContext | index |
| `midSessionProbe.js` | C3: decision probe every 4 turns at turn boundary; authority=NONE (hint or request early settle only) | shouldProbeAtTurn, runMidSessionProbe | index |
| `missionGovernor.js` | Concurrency gate (FIFO queue; 1 slot = session+Chromium+LLM); states CREATED→QUEUED→RUNNING→terminal; stuck-mission watchdog | submitMission, governorStats | index, phaseRouter |
| `missionGovernor` budget pool | Turn-pool grants/debits for revalidation; 500 ceiling | — | index |
| `capabilities.js` | Capability registry + topological orchestrator (replaces linear pipeline; skip-on-failure) | runAutonomyPipeline | index, pipeline.js |
| `appUnderstanding.js` | App-Understanding Engine: intent+evidence+knowledge → validated app model (LLM reasoning stage) | buildAppUnderstanding | capabilities |
| `appModel.js` | INTENT/OBSERVED/INFERENCE/UNKNOWN model; confidence objects; conflicts | createAppModel, serializeAppModel | capabilities, appUnderstanding |
| `intentModel.js` | Structured mission intent; provenance-weighted expectations | createMissionIntent | workflowEngine, domainUnderstanding |
| `domainUnderstanding.js` | Multi-hypothesis domain classification (weighted evidence) | classifyDomain | expectedVsObserved |
| `featureGap.js` + `featureGapValidation.js` | Gap detection/enhancement + **C3 explicit-expectation gate** (IMPLEMENTED/PARTIALLY/NOT_FOUND/BLOCKED/UNVERIFIED) | analyzeFeatureGaps, validateFeatureGaps | capabilities, uxAssessment |
| `findings.js` | Global findings hub: lifecycle, scoping, links, sync, stats, migrations | addFinding, listFindings, transitionFindingStatus | 9 modules |
| `findingEnrichment.js` | Async post-mission deterministic enrichment + dedup merge | enrichSessionFindings | phaseRouter |
| `findingIntelligence.js` | 20-category bug intel: severity/priority/effort/root-cause with reasons; evidence redaction | enrichFinding, detectDuplicates | 8 modules |
| `duplicateSuppression.js` | ⚠ **DEAD CODE** — zero importers (superseded) | — | none |
| `devIntelligence.js` | Per-finding root-cause + fix suggestions (LLM), app improvement report, quality scoring | analyzeFinding, buildFixPrompt | capabilities, index |
| `fixValidation.js` | Fix-validation run store/lifecycle + metrics + event bus | createRun, completeRun, listValidations | 5 modules |
| `fixStatusEngine.js` | **Deterministic final fix status** — the only place a verdict is derived; LLM may never set it | classifyFixStatus, detectPartialFix | fixValidation, validationExecutorCore |
| `validationExecutorCore.js` | Builds validation test case from finding; runs attempts via replay | executeValidation | index, phaseRouter |
| `validationLoop.js` | Iteration metadata, convergence, stop reasons, decision→action mapping, replan/revalidation prompts | resolveAction | index, autonomyController |
| `replay.js` | Test-case replay + suite runner; **the BrowserStack execution path** (CDP caps; strict vs fallback) | runTestCase, runTestSuite, planExecutionMode | index, scheduler, validationExecutorCore |
| `selfHeal.js` | Broken-selector detection → DOM snapshot → LLM selector proposal → patch | analyzeFailure, patchTestCase | replay |
| `regressionStore.js` | Regression run history + trend | addRegressionRun, getTrend | scheduler, metrics, pulseV2Router |
| `scheduler.js` | 60s cron tick; delegates to replay.runTestSuite | executeSchedule, startScheduler | index |
| `suites.js` / `workflows.js` / `testCases.js` / `projects.js` / `missions.js` | Respective JSON stores with atomicWrite | list/create/upsert… | routers |
| `store.js` | Session store (memory + `.qase/sessions.json` mirror); SSE bus; prune 50 | createSession, emit, bus | 10 modules |
| `evidenceGraph.js` | Evidence graph: exploration→evidence→findings→assessment→decision; integrity/coverage/pruning | createEvidence, verifyIntegrity | 7 modules |
| `knowledge.js` | Pattern store: write-after (validated only), read-before (hints), validate-after, conflict detection, decay | writeKnowledge, queryKnowledge, applyDecay | 6 modules |
| `targetGuard.js` | URL allowlist boundary: public HTTP/S; loopback only on configured ports; deny private ranges/metadata; enforced at ingest + CDP page/redirect boundaries; webhook URL validation | validateTargetUrl, installPageBoundary, validateWebhookUrl | 8 modules |
| `browserstackTest.js` | 2-stage connection probe (Basic-auth plan.json + CDP WS handshake). No minutes burned. | testBrowserstackConnection | index (settings) |
| `deviceContext.js` | Device preference → Playwright descriptor; BrowserStack real-device allowlist | resolveDeviceContext, validateDeviceRequest | index, replay, agent |
| `executionEnvironment.js` | Execution provenance (provider/mode/device); `BrowserStackStrictError`; secret redaction | buildExecutionEnvironment, redactSecrets | replay, validationExecutorCore |
| `webhooks.js` | Simple fire-and-forget notifier (`QASE_WEBHOOK_URL`) | notifyReport, notifyTestFailure | agent, scheduler |
| `webhookDelivery.js` | B1 production webhooks: subscriptions+deliveries persisted, HMAC-SHA256 signatures, backoff (max 5), restart recovery, SSRF-guarded | enqueueDelivery, signWebhookPayload | index |
| `integrationAuth.js` | HMAC request auth: canonical string, timing-safe verify, scopes, workspace match | requireIntegrationAuth, verifySignedRequest | index |
| `config.js` | Settings store (`.qase/config.json`) + env fallback; masked public view; LLM connection probe (`GET {baseUrl}/models`) | getConfig, getPublicConfig, saveConfig, testConnection | index, several |
| `metrics.js` / `apiUsage.js` | Dashboard aggregates / bounded `/api/v2` telemetry (90-day, authenticated-only) | getDashboardMetrics, apiUsageCounter | index, pulseV2Router |
| `openapiDocument.js` + `pulseV2Router.js` + `pulseProjection.js` + `pulseHelpers.js` + `pagination.js` | C1 read surface + live OpenAPI doc | buildOpenApiDocument | index |
| `atomicWrite.js` | temp+rename atomic JSON writes — foundation of ALL persistence (19 importers) | atomicWrite | 19 modules |
| `stateIntegrity.js` / `storeHygiene.js` / `stateTransitions.js` | Read-only integrity checks / guarded cleanup / legal finding transitions | — | index |
| `demoSite.js` | Deliberately broken practice app | mountDemoSite | index |
| `report.js`, `exporters.js`, `bugExporters.js`, `junit.js` | Markdown report + md/github/jira/linear/junit exports | buildReportMarkdown | index |
| `riskModel.js`, `qualityAssessment.js`, `recommendationEngine.js`, `uxModel.js`, `uxChecks.js`, `uxFriction.js`, `uxSweep.js`, `uxAssessment.js` | Phase-17 UX intelligence stack (deterministic sweep ≤12 pages ×3 viewports, friction patterns, quality scoring) | runUxAssessment | capabilities, routers |
| `testGen.js` | **Owns `callLLM`** (OpenAI-compatible `/chat/completions`, 120s timeout, 2 retries) + workflow→test-case generation | callLLM, generateTestCasesFromWorkflow | 6 modules |
| `testRestore.js`, `baselines.js`, `replayStore.js` | Config restore markers / visual baselines / replay history | — | replay, tests |

## AI architecture (verified call sites)

Agent turns: SDK-owned transport (provider/model/baseUrl passed at `agent.js:188–201`). Direct LLM calls all via `testGen.js:121 callLLM` → `fetch({baseUrl}/chat/completions)`: workflow→test-cases (`testGen.js:244`), finding root-cause (`devIntelligence.js:57`), app improvement report (`devIntelligence.js:118`), self-heal selector (`selfHeal.js:172`), feature-gap enhancement (`featureGap.js:1288`), app-understanding reasoning (`appUnderstanding.js:579/649`). Probe: `config.js:343` `GET {baseUrl}/models`. No prompts or chain-of-thought are persisted — decision traces are structured 13-field records only.

## Data flow (autonomous mission)

```
POST /api/v1/missions → intent + budget → governor queue → slot →
agent turns (SDK+Playwright; targetGuard boundary; secrets via placeholders) →
evidence graph writes → findings sync (missionId stamped) → decision cascade
(every decision point + every 4 turns) → resolveAction → budget check →
terminal state → async: enrichment, dedup, knowledge write (validated only),
UX assessment (post-finalize), evidence integrity → report + metrics
```
