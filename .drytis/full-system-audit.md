# QASE — Full System Audit & Autonomous Readiness Assessment

**Date:** 2026-08-12  
**Auditor:** AI Agent (read-only, no modifications)  
**Scope:** Complete repository, runtime, data, frontend, backend, tests, E2E behavior  
**Method:** File inspection, import analysis, API probing, test execution, data analysis, runtime verification

---

## 1. Executive Summary

QASE is a functional autonomous QA agent that can receive an application URL, explore it via browser automation, detect defects, capture evidence, assess quality, and produce structured findings. The core autonomous pipeline works end-to-end: proven by real missions that completed with findings, evidence, quality scores, and verdicts.

**However, QASE is NOT production-ready.** It has significant reliability gaps, security holes in the internal API, unbounded data growth, a concurrency mismatch that causes browser contention, and missing test coverage for the integration layer. The frontend lacks loading states and suffers from data staleness after reload. BrowserStack is configured but never verified.

**The single biggest blocker:** `concurrentRuns=20` in config allows 20 simultaneous missions to compete for a single browser instance, causing the most common failure mode — agent turns wasted on browser tab recovery instead of testing.

---

## 2. Current Architecture

```
External Consumer
    ↓ POST /api/v1/missions (JWT or API token auth)
    ↓ Immediate 202 response (missionId, sessionId, correlationId)
    ↓
Mission Created (missions.json, in-memory + disk)
    ↓ Fire-and-forget: void runAgent(session).catch()
    ↓
Agent Runtime (agent.js)
    ↓ ensureRuntime() → CleanSlateNodeAgentRuntime (SDK)
    ↓ runTurn() → LLM call → tool execution loop (maxTurns budget)
    ↓
Browser Bridge (browserBridge.js)
    ↓ Playwright Chromium (headless, single instance)
    ↓ 8s timeout per action, 3-failure recovery threshold
    ↓
Agent explores: navigate, click, fill, snapshot, diagnostics
    ↓ Agent files findings via report_finding tool
    ↓ Agent completes via finish_qa_report tool OR hits turn limit
    ↓
Mission Finalizer (30s timer + lazy on poll)
    ↓ Phase 8: intent → domain → dedup → expected vs observed → gap report
    ↓ Phase 9: workflow engine (validate workflows → generate findings)
    ↓ Phase 4: decision engine (collect signals → evaluate policy → safety override)
    ↓ Phase 6: evidence graph (collect → link → coverage)
    ↓ Phase 5: validation loop (resolve action → REVALIDATE or stop)
    ↓
Mission Completed → fireMissionWebhooks() → report available
```

**Tech stack:** Node.js, Express 5, @cleanslate/sdk (agent runtime), Playwright (browser), vanilla JS frontend (no framework), JSON file persistence.

---

## 3. Repository Map

### Source Code (server/ — 47 files, 23,676 lines)
| File | Lines | Purpose | Class |
|---|---|---|---|
| index.js | 3,457 | Express server, all routes, mission finalizer | A — CORE |
| featureGap.js | 1,554 | LLM-enhanced feature gap analysis | B — ACTIVE |
| evidenceGraph.js | 1,202 | Evidence collection, linking, coverage | A — CORE |
| workflowEngine.js | 1,085 | Workflow validation, finding generation | A — CORE |
| appUnderstanding.js | 1,076 | Static + dynamic app analysis | B — ACTIVE |
| decisionEngine.js | 1,015 | 7-type deterministic decision policy | A — CORE |
| replay.js | 896 | Test case replay + visual regression | B — ACTIVE |
| knowledge.js | 866 | Knowledge persistence + LLM enhancement | B — ACTIVE |
| expectedVsObserved.js | 777 | Feature status comparison | A — CORE |
| capabilities.js | 770 | Capability orchestrator (pipeline) | B — ACTIVE |
| domainUnderstanding.js | 714 | Domain classification | A — CORE |
| agent.js | 692 | Agent runtime, turn execution | A — CORE |
| validationLoop.js | 689 | Revalidation loop, convergence | A — CORE |
| intentModel.js | 606 | Intent → feature mapping | A — CORE |
| devIntelligence.js | 594 | Finding analysis, quality scoring | A — CORE |
| browserBridge.js | 559 | Playwright browser lifecycle | A — CORE |
| duplicateSuppression.js | 439 | Finding deduplication | A — CORE |
| findings.js | 422 | Global findings store | A — CORE |
| missions.js | 404 | Mission model + CRUD | A — CORE |
| workflows.js | 401 | Workflow model | B — ACTIVE |
| knowledgeModel.js | 397 | Knowledge item model | B — ACTIVE |
| appModel.js | 383 | App metadata model | B — ACTIVE |
| config.js | 309 | 3-tier config (defaults→env→file) | A — CORE |
| scheduler.js | 294 | Cron-based mission scheduling | B — ACTIVE |
| testGen.js | 281 | Test case generation from workflows | B — ACTIVE |
| store.js | 277 | Session store (source of truth) | A — CORE |
| testCases.js | 255 | Test case model | B — ACTIVE |
| selfHeal.js | 249 | LLM-assisted selector healing | C — LEGACY |
| integrationAuth.js | 248 | JWT auth + integration identity | A — CORE |
| authorization.js | 248 | Workspace/project/mission authz | A — CORE |
| baselines.js | 224 | Visual regression baselines | C — LEGACY |
| projects.js | 196 | Project model | B — ACTIVE |
| errorTypes.js | 196 | Error classification | A — CORE |
| suites.js | 188 | Test suite model | C — LEGACY |
| qaTools.js | 177 | Agent tool definitions (report_finding, etc.) | A — CORE |
| demoSite.js | 163 | Built-in demo target | C — LEGACY |
| exporters.js | 162 | CSV/JSON export | C — LEGACY |
| regressionStore.js | 158 | Regression run store | C — LEGACY |
| devReport.js | 145 | Dev report markdown generation | B — ACTIVE |
| bugExporters.js | 141 | JIRA/GitHub export | D — DUPLICATE/UNUSED |
| prompt.js | 123 | Agent system prompt builder | A — CORE |
| secrets.js | 112 | Per-session credential vault | B — ACTIVE |
| metrics.js | 106 | Dashboard metrics | B — ACTIVE |
| replayStore.js | 101 | Replay run store | C — LEGACY |
| webhooks.js | 100 | Webhook helpers | B — ACTIVE |
| junit.js | 90 | JUnit XML export | C — LEGACY |
| report.js | 74 | Report markdown builder | B — ACTIVE |
| atomicWrite.js | 44 | Atomic file write (temp+rename) | A — CORE |
| pipeline.js | 17 | Re-export shim for capabilities.js | F — DEAD CODE (shim) |

### Frontend (public/ — 9 files, 13,935 lines)
| File | Lines | Purpose |
|---|---|---|
| styles.css | 6,540 | All styling (no CSS framework) |
| app.js | 2,392 | Main app: runs view, SSE, mission creation, settings |
| tests.js | 1,373 | Test cases view + replay |
| pipeline.js | 1,307 | Pipeline visualization |
| index.html | 742 | Single-page HTML shell |
| bugs.js | 525 | Bugs/findings hub |
| schedules.js | 411 | Schedules view |
| workflows.js | 292 | Workflows view |
| shared.js | 272 | Shared state + API wrapper |
| router.js | 81 | Hash-based router |

### Tests (tests/ — 30 available files)
| Category | Files | Tests | Status |
|---|---|---|---|
| Phase 1 (Error types, session, mission) | 4 | ~100 | ✅ Pass |
| Phase 2 (App model, validation, understanding) | 3 | ~60 | ✅ Pass |
| Phase 3 (Knowledge) | 2 | ~50 | ✅ Pass |
| Phase 4 (Decision engine, integration) | 2 | ~40 | ✅ Pass |
| Phase 5 (API, validation loop) | 2 | ~25 | ✅ Pass |
| Phase 6 (Evidence graph) | 1 | 32 | ✅ Pass |
| Phase 8 (Intent understanding) | 1 | 44 | ✅ Pass |
| Phase 9.x (Stabilization, revalidation, reliability) | 8 | ~200 | ✅ Mostly pass |
| Phase 10-14 (Visual regression, pipeline, etc.) | 4 | ~80 | ✅ Pass |
| Phase 11A (Findings store) | 1 | 27 | ✅ Pass |
| **LOST to corruption** | 6 | ~126 | ❌ Gone |

---

## 4. Useful Files

**Core engine (essential for autonomous operation):**
- `server/index.js` — Server, routes, mission finalizer (the 420-line pipeline)
- `server/agent.js` — Agent runtime
- `server/browserBridge.js` — Browser automation
- `server/decisionEngine.js` — Decision policy
- `server/validationLoop.js` — Revalidation
- `server/evidenceGraph.js` — Evidence system
- `server/workflowEngine.js` — Workflow validation
- `server/qaTools.js` — Agent tool definitions
- `server/prompt.js` — Agent prompt
- `server/config.js` — Configuration

**Integration layer (for external consumers):**
- `server/integrationAuth.js` — JWT authentication
- `server/authorization.js` — Access control
- `server/missions.js` — Mission lifecycle model

**Assessment pipeline (quality + findings):**
- `server/intentModel.js` — Intent → feature expectations
- `server/domainUnderstanding.js` — Domain classification
- `server/expectedVsObserved.js` — Feature gap detection
- `server/duplicateSuppression.js` — Finding dedup
- `server/devIntelligence.js` — Quality scoring
- `server/findings.js` — Global findings store

---

## 5. Unused/Suspicious Files

| File/Dir | Type | Evidence | Recommendation |
|---|---|---|---|
| `server/validationLoop_corrupt.js/` | Empty dir | Created during ext4 corruption recovery | Remove directory |
| `server/validationLoop_recovered.js/` | Empty dir | Same | Remove directory |
| `server/pipeline.js` (17 lines) | Dead code | Pure re-export shim — `export { runAutonomyPipeline } from './capabilities.js'` | Keep for compat or inline |
| `server/bugExporters.js` (141 lines) | Unused | JIRA/GitHub export — imported by index.js but no UI triggers it | Verify if needed |
| `tests_old/` (2 files) | Old | Superseded by tests/ versions | Remove |
| `49 *.png` files in root | Artifacts | UI testing screenshots | Move to docs/screenshots/ |
| `qase-project.zip/.tar.gz` | Archives | Packaged versions, redundant with git | Remove |
| `chrometrace.log` (295KB) | Debug | Chrome debug trace log | Remove |
| `docs/` (11 files) | Documentation | Phase 1-4 docs | Consolidate with .drytis/ |
| `userDocs/` (6 files) | Transcripts | Meeting transcripts | Keep or archive |
| `.drytis/*.js` (13 files) | Benchmark scripts | E2E runners, benchmark scripts | Keep as tooling |
| `.drytis/benchmark-state.json` | Runtime data | Benchmark state | Keep |

---

## 6. Backend Assessment

| Subsystem | Exists | Connected | Used | Tested | Reliable | Blocking |
|---|---|---|---|---|---|---|
| Server startup | ✅ | ✅ | ✅ | ✅ | ✅ | No |
| Routing (124 routes) | ✅ | ✅ | ✅ | Partial | ✅ | No |
| Middleware chain | ✅ | ✅ | ✅ | ❌ | ✅ | No |
| Authentication | ✅ | ✅ | ✅ | Lost | ✅ | No |
| Authorization | ✅ | ✅ | ✅ | Lost | ✅ | No |
| Mission lifecycle | ✅ | ✅ | ✅ | ✅ | ⚠️ | **Yes** (concurrency) |
| Sessions | ✅ | ✅ | ✅ | ✅ | ✅ | No |
| Worker execution | ✅ | ✅ | ✅ | ✅ | ⚠️ | **Yes** (maxTurns) |
| Agent runtime | ✅ | ✅ | ✅ | ✅ | ✅ | No |
| Browser execution | ✅ | ✅ | ✅ | ✅ | ⚠️ | **Yes** (single instance) |
| Evidence system | ✅ | ✅ | ✅ | ✅ | ✅ | No |
| Findings | ✅ | ✅ | ✅ | ✅ | ✅ | No |
| Test cases | ✅ | ✅ | ✅ | ✅ | ✅ | No |
| Workflows | ✅ | ✅ | ✅ | ✅ | ✅ | No |
| Quality assessment | ✅ | ✅ | ✅ | ✅ | ✅ | No |
| Decision engine | ✅ | ✅ | ✅ | ✅ | ✅ | No |
| Validation loop | ✅ | ✅ | ✅ | ✅ | ⚠️ | **Yes** (self-HTTP-call) |
| Knowledge | ✅ | ✅ | ✅ | ✅ | ✅ | No |
| Webhooks | ✅ | ✅ | ⚠️ | Lost | ⚠️ | No (in-memory only) |
| Scheduling | ✅ | ✅ | ✅ | ✅ | ✅ | No |
| Reporting | ✅ | ✅ | ✅ | ✅ | ✅ | No |
| Persistence | ✅ | ✅ | ✅ | ✅ | ⚠️ | No (raw writeFileSync in missions.js) |
| Error handling | ⚠️ | Partial | Partial | ❌ | ⚠️ | No |
| Cleanup/pruning | ✅ | ✅ | ✅ | ❌ | ⚠️ | No (aggressive session pruning) |

---

## 7. Frontend Assessment

**5 functional pages, all real (no mock data):** Runs (#/runs), Tests (#/tests), Workflows (#/workflows), Schedules (#/schedules), Bugs (#/bugs).

| Area | Status | Details |
|---|---|---|
| Routing | ✅ | Hash-based, 5 pages |
| State management | ⚠️ | Single mutable `state` object, no reactivity |
| API calls | ⚠️ | Unified `api()` wrapper, but `.catch(() => [])` silently swallows errors |
| Loading states | ❌ | Per-button text only ("Sending…"), no skeletons, no global spinner |
| Empty states | ⚠️ | Present but inconsistent |
| Error states | ❌ | Errors silently caught, stale UI shown |
| Data refresh | ⚠️ | SSE primary (auto-reconnect), manual on navigation, no polling fallback |
| Caching | ❌ | None — every navigation re-fetches |
| Forms | ✅ | Mission creation form works |
| Navigation | ✅ | Hash routing with routechange events |

**"Old data after reload" root cause:** The `/api/sessions` endpoint returns ALL in-memory sessions (427) with their current state. On server restart, sessions.json is loaded (last 50 after pruning), but sessions accumulate in memory during runtime. The list view shows stale summaries (0 activities) while the detail endpoint loads fresh data. Frontend catches fetch errors as empty arrays, masking failures.

---

## 8. API Assessment

**124 total routes:** 95 internal `/api/*` + 29 integration `/api/v1/*`.

| Issue | Severity | Details |
|---|---|---|
| ~20 GET routes lack auth | HIGH | `/api/sessions`, `/api/findings`, `/api/knowledge`, `/api/decisions` etc. expose data without authentication |
| `PATCH /api/findings/:id/status` lacks auth | HIGH | Mutating endpoint without `requireApiToken` |
| No global error handler | MEDIUM | Unhandled async errors crash the process |
| No 404 catch-all | LOW | Unknown routes return Express default HTML error |
| No CORS | LOW | Frontend and API same origin (Caddy proxy) |
| No rate limiting | MEDIUM | Any consumer can flood mission creation |
| Webhooks in-memory only | MEDIUM | Lost on server restart |
| Response format inconsistency | LOW | Some return arrays, some `{data: []}`, some `{status, data}` |

---

## 9. Persistence Assessment

**11 JSON file stores + in-memory arrays.** Dual-layer: in-memory (source of truth during operation) + JSON file (write-behind mirror via 250ms debounced atomic writes).

| Store | Size | Growth | Pruning | Risk |
|---|---|---|---|---|
| missions.json | 16MB | Unbounded | None | Write timeout at scale |
| sessions.json | 7MB | Bounded by cleanup | Last 50 only | Aggressive — permanent data loss |
| evidence-graph.json | 9.8MB | Unbounded | None | Load time growing |
| findings.json | 500KB | Bounded | None | OK |
| workflows.json | 1.9MB | Bounded | None | OK |
| test-cases.json | 1.7MB | Bounded | None | OK |
| config.json | 583B | Fixed | N/A | OK |
| **Webhooks** | 0 (in-memory) | Reset on restart | N/A | **Data loss on restart** |

**Data loss risks:**
1. 250ms write debounce window — last 250ms of changes lost on crash
2. missions.js uses raw `writeFileSync` instead of atomic write — corruption risk
3. Session pruning permanently deletes (no archive) — historical data lost
4. Webhooks are in-memory only — registration lost on restart
5. 1318 missions in "created" (never started) state — stale data consuming memory

---

## 10. Worker Assessment

| Aspect | Status | Details |
|---|---|---|
| Fire-and-forget pattern | ✅ | `void runAgent(session).catch()` — API returns immediately |
| Worker independence | ✅ | Client disconnect doesn't affect worker |
| Mission persistence | ✅ | missions.json written every 500ms |
| Mission finalizer | ✅ | 30s timer + lazy on poll + event-driven |
| Idempotent finalization | ✅ | Signature hash prevents double-finalization |
| Browser lifecycle | ⚠️ | Single browser instance shared across missions |
| Concurrent execution | ❌ | `concurrentRuns=20` but 1 browser — contention |
| Auto-revalidation | ⚠️ | Uses fragile self-HTTP-call instead of direct function call |
| Error recovery | ⚠️ | `.catch(() => {})` silently swallows errors |

---

## 11. Agent/LLM Assessment

| Aspect | Status | Details |
|---|---|---|
| Model | z-ai/glm-5.1 | Via custom gateway (https://llm.drytis.ai/v1) |
| Reasoning level | low | Configurable |
| Max turns | 30 | Was 10 (too low), now 30 (adequate for simple apps) |
| Turn timeout | 20 min | Hard backstop |
| Idle timeout | 5 min | Triggers retry (up to 2 retries) |
| Tool budget | SDK-enforced | 20 ALLOWED_TOOLS + 3 custom QA tools |
| Browser idle | 0ms (disabled) | Browser persists between turns indefinitely |
| Command execution | Blocked | `approveCommand: async () => false` |
| Context management | SDK handles | Context grows with each turn |
| Model fallback | None | Single model, no fallback |

**Biggest limitation:** The agent has 30 turns to understand, plan, explore, test, and report. For complex apps, this is insufficient — the agent often exhausts turns before testing all requirements. The model (glm-5.1) is adequate but not state-of-the-art for complex reasoning tasks.

---

## 12. Browser Automation Assessment

| Aspect | Status | Details |
|---|---|---|
| Playwright integration | ✅ | Monkey-patches SDK's browserAutomationService |
| Chromium detection | ✅ | 4-tier resolution with ELF magic byte validation |
| Headless mode | ✅ | Configurable, default true |
| Navigation | ✅ | 1600ms URL settlement polling |
| Clicks/fills | ✅ | 8s timeout per action (Promise.race) |
| Snapshots | ✅ | Element extraction with unique CSS paths |
| Screenshots | ✅ | Via browser_screenshot tool |
| Diagnostics | ✅ | Console errors + failed network requests |
| Session persistence | ✅ | suspend()/restoreSession() for cookies/localStorage |
| Dead browser recovery | ✅ | 3 consecutive failures → context disposal + fresh browser |
| Dialog handling | ⚠️ | `alert()`/`confirm()` cause click timeouts — no dialog auto-dismiss |
| Tab management | ⚠️ | Multiple tabs spawn during navigation issues |
| Single instance | ❌ | Only 1 browser, shared across all concurrent missions |

**Biggest limitation:** `alert()`/`confirm()` blocking dialogs cause click timeouts that waste agent turns. There is no auto-dismiss handler for JavaScript dialogs. The recovery mechanism (3 failures → restart) works but wastes 3+ turns each time.

---

## 13. Evidence Assessment

**WORKING.** 12 evidence types, 14 edge types, provenance chains. 14,018 evidence items currently stored. Coverage model (verified/partial/unverified) works. Integrity hash + orphan detection functional. Evidence persists to evidence-graph.json.

**Issue:** Unbounded growth (9.8MB, no pruning). Evidence for old missions is never cleaned up.

---

## 14. Findings Assessment

**WORKING.** 273 findings in global store. Severity distribution: 67 critical, 97 high, 93 medium, 15 low, 1 info. All status=open. Duplicate suppression works (threshold 0.38). Finding confidence scoring (strong=0.85, medium=0.65, weak=0.4). Agent files findings via `report_finding` tool with title, severity, expected, actual, confidence, reproducibility.

**Issue:** `findingsCount=0` on mission objects even when sessions have findings — stale data in missions.json because findingsCount isn't updated from session data in all code paths.

---

## 15. Quality/Decision Assessment

**WORKING.** Deterministic rule cascade, 7 decision types. Quality scoring uses canonical (deduplicated) findings. Decision engine collects 5 weighted signals, applies 4 safety overrides. Confidence model with penalty for insufficient signals. Error-safe fallback returns ESCALATE (never PASS).

**Issue:** Budget model is crude (LLM calls ≈ activity count). No actual token counting.

---

## 16. Revalidation Assessment

**PARTIALLY WORKING.** Iteration limits (max 10, no-improvement threshold 2, meaningful improvement delta 5). Convergence detection (regression/improving/declining/no_improvement/stable). Stop reasons: MAX_ITERATIONS, NO_IMPROVEMENT, APPROVED, FAILED.

**Critical issue:** Revalidation uses **self-HTTP-call** pattern (`fetch('http://localhost:5173/api/v1/missions/:id/revalidate')`) instead of direct function call. This is fragile — if the server is busy, port is blocked, or network is flaky, revalidation silently fails.

---

## 17. Authentication/Authorization

| Check | Status | Details |
|---|---|---|
| JWT authentication | ✅ | HS256 via jose, QASE_INTEGRATION_SECRET |
| API token fallback | ✅ | Legacy `requireApiToken` for internal API |
| Integration auth middleware | ✅ | `requireIntegrationAuth` on all /api/v1/ routes |
| Workspace isolation | ✅ | authorizeWorkspace checks workspaceId |
| Project isolation | ✅ | authorizeProject checks workspace chain |
| Mission access control | ✅ | authorizeMission on 21 mission lookups |
| Session/finding isolation | ✅ | Via mission chain |
| **Internal API auth** | ❌ | ~20 GET routes + 1 PATCH route lack auth |
| Webhook signature | ✅ | HMAC-SHA256 with per-webhook secret |
| SSRF protection | ✅ | Blocks all internal IPs on webhook URLs |
| No hardcoded secrets | ✅ | All via env/config |
| Correlation ID | ✅ | X-Correlation-Id header |

---

## 18. BrowserStack

**CLASSIFICATION: CONFIGURED BUT DISABLED — NEVER VERIFIED**

| Check | Result |
|---|---|
| Configuration exists | ✅ `browserstackEnabled: false` |
| Credentials configured | ⚠️ User "tRuEje", key NOT SET |
| Connection code exists | ✅ `replay.js` has BrowserStack CDP path |
| Code path reachable | ⚠️ Only in replay.js (test case replay), NOT in autonomous agent |
| Feature enabled | ❌ Disabled in config |
| UI exposes status | ✅ Settings page shows BrowserStack toggle |
| Actual browser session | ❌ Never tested |
| Evidence returns | ❌ Never tested |

**BrowserStack is only wired into the test case replay system (replay.js), NOT into the autonomous agent (agent.js/browserBridge.js).** Even if enabled, the autonomous agent would still use local Chromium.

---

## 19. Settings

| Setting | UI | API | Persisted | Used | Status |
|---|---|---|---|---|---|
| Provider | ✅ | ✅ | ✅ | ✅ | KEEP |
| API Key | ✅ | ✅ | ✅ (vault) | ✅ | KEEP |
| Base URL | ✅ | ✅ | ✅ | ✅ | KEEP |
| Model | ✅ | ✅ | ✅ | ✅ | KEEP |
| Reasoning | ✅ | ✅ | ✅ | ✅ | KEEP |
| Max Turns | ✅ | ✅ | ✅ | ✅ | KEEP (default too low) |
| Concurrent Runs | ✅ | ✅ | ✅ | ⚠️ | **FIX** (20 but 1 browser) |
| Headless | ✅ | ✅ | ✅ | ✅ | KEEP |
| BrowserStack toggle | ✅ | ✅ | ✅ | ❌ | **HIDE** (not wired to agent) |
| BrowserStack user/key | ✅ | ✅ | ✅ | ❌ | **HIDE** |
| Self-heal toggle | ✅ | ✅ | ✅ | ✅ | KEEP |
| Self-heal threshold | ✅ | ✅ | ✅ | ✅ | KEEP |
| Auto-save workflow | ✅ | ✅ | ✅ | ✅ | KEEP |
| Auto-generate tests | ✅ | ✅ | ✅ | ✅ | KEEP |
| Auto-dev report | ✅ | ✅ | ✅ | ✅ | KEEP |
| Connection test | ✅ | ✅ | N/A | ✅ | KEEP |

---

## 20. UI/UX

| Issue | Severity | Details |
|---|---|---|
| No loading skeletons | MEDIUM | Pages show empty state then suddenly fill with data |
| Silent API error swallowing | HIGH | `.catch(() => [])` masks failures as empty data |
| Stale data after reload | HIGH | Session list shows 0 activities; detail has 12 messages |
| No pagination | MEDIUM | /api/sessions returns ALL 427 sessions |
| No build/minification | LOW | 600KB raw JS served unminified |
| 49 screenshot files in root | LOW | Clutter, unprofessional |
| Inconsistent error feedback | MEDIUM | Some errors toast, some silently fail |
| No offline handling | LOW | SSE drops show "reconnecting…" but no fallback |

---

## 21. Test Coverage

| Metric | Value |
|---|---|
| Test files available | 30 |
| Tests run | 729 |
| Tests passed | 722 (99.0%) |
| Tests failed | 1 (E2E timeout, not code regression) |
| Tests cancelled | 6 (parent timeout) |
| Lost test files | 6 (~126 tests to ext4 corruption) |

**Critical missing tests:**
- Phase 10 security tests (38 scenarios) — LOST
- Phase 10 integration simulation (6 tests) — LOST
- Phase 11 integration tests (31 tests) — LOST
- Phase 11 standalone E2E (12 tests) — LOST
- Next-build worker contract tests (30 tests) — LOST
- Next-build final E2E (9 tests) — LOST

**Test quality issues:**
- E2E tests that run real missions are timing-sensitive (fail under load)
- Some tests only verify hardcoded values, not real behavior
- No CI pipeline — tests run manually

---

## 22. E2E Result

**VERIFIED via previous build.** Mission `db2a23f7` against ContactVault (port 9906):
- Status: completed, Verdict: fail, Quality: 15/100, Findings: 2, Evidence: 29 items
- Duration: 185.5s, 30 agent turns, 7 tool types
- Agent found real bug (email validation accepts invalid emails)
- Complete chain proven: API → worker → agent → browser → evidence → findings → quality → decision → completed → report

**1,852 total missions in data. 401 completed, 41 failed, 92 aborted, 1,318 in "created" (never started).**

---

## 23. Security

| Check | Status | Severity |
|---|---|---|
| ~20 GET routes expose data without auth | ❌ | HIGH |
| PATCH /api/findings/:id/status no auth | ❌ | HIGH |
| No rate limiting | ❌ | MEDIUM |
| No global error handler | ❌ | MEDIUM |
| No CORS policy | ⚠️ | LOW |
| Webhook SSRF protection | ✅ | — |
| Webhook HMAC signature | ✅ | — |
| Integration API auth (all /api/v1/) | ✅ | — |
| Workspace/project isolation | ✅ | — |
| No hardcoded secrets | ✅ | — |
| No secrets in responses | ✅ | — |

---

## 24. Performance/Stability

| Metric | Value | Status |
|---|---|---|
| API response (config) | 54ms | ✅ |
| API response (sessions) | 46ms | ✅ |
| API response (missions) | 135ms | ⚠️ (growing with data) |
| API response (findings) | 49ms | ✅ |
| Server memory (RSS) | 318MB | ⚠️ |
| Data files total | 77MB | ⚠️ |
| Mission execution | 185-326s | ✅ (3-5 min per mission) |
| Frontend payload | ~600KB unminified | ⚠️ |
| Sessions returned per API call | 427 | ❌ (no pagination) |

**"Old data after reload" bottleneck:** The /api/sessions endpoint returns all 427 in-memory sessions as a single JSON response. On reload, the frontend fetches this, renders immediately, then lazy-loads session details. The mismatch between list summaries and detail data creates the appearance of "old data."

---

## 25. Autonomous Readiness Matrix

| # | Capability | Status | Evidence |
|---|---|---|---|
| 1 | Receive application | ✅ PASS | POST /api/v1/missions accepts targetUrl |
| 2 | Understand application | ✅ PASS | appUnderstanding.js + domainUnderstanding.js classify the app |
| 3 | Determine what to test | ✅ PASS | intentModel.js generates feature expectations |
| 4 | Explore application | ✅ PASS | Agent performs 30 turns of browser actions |
| 5 | Generate actions | ✅ PASS | LLM generates tool calls based on observations |
| 6 | Execute actions | ✅ PASS | browserBridge.js executes via Playwright |
| 7 | Detect unexpected behavior | ⚠️ PARTIAL | Agent detects obvious bugs, misses subtle ones (persistence) |
| 8 | Capture evidence | ✅ PASS | 29 evidence items per mission |
| 9 | Create finding | ✅ PASS | report_finding tool + workflow engine |
| 10 | Avoid duplicate findings | ✅ PASS | duplicateSuppression.js (threshold 0.38) |
| 11 | Assess severity/confidence | ✅ PASS | Confidence scoring (0.4-0.85) |
| 12 | Calculate quality | ✅ PASS | Quality score 0-100 |
| 13 | Make decision | ✅ PASS | 7 decision types, deterministic |
| 14 | Revalidate after changes | ⚠️ PARTIAL | Self-HTTP-call pattern is fragile |
| 15 | Stop safely | ✅ PASS | Terminal states: completed, failed, aborted |
| 16 | Recover from failures | ⚠️ PARTIAL | Browser recovery works, but alert() dialogs still cause issues |
| 17 | Produce final report | ✅ PASS | GET /api/v1/missions/:id/report |
| 18 | Notify via webhook | ⚠️ PARTIAL | System works but in-memory only |
| 19 | Work standalone | ✅ PASS | No external dependencies (besides LLM gateway) |
| 20 | Handle concurrent requests | ❌ FAIL | concurrentRuns=20 but 1 browser |

---

## 26. Critical Gaps (Prioritized)

### P0 — BLOCKS AUTONOMOUS PRODUCT

| # | Gap | Evidence | Impact | Fix | Effort |
|---|---|---|---|---|---|
| P0-1 | `concurrentRuns=20` with 1 browser | config.json; missions compete for browser | Agents waste turns on browser recovery; missions fail | Set concurrentRuns=1; add browser queue | Small |
| P0-2 | No `alert()`/`confirm()` dialog handler | browserBridge.js has no dialog auto-dismiss | Agent click timeouts waste 3+ turns per dialog | Add `page.on('dialog', d => d.dismiss())` | Small |
| P0-3 | Internal API routes lack auth | 20+ GET routes + 1 PATCH route unprotected | Data exposure, unauthorized mutations | Add requireApiToken to all mutating routes; auth on sensitive GETs | Medium |

### P1 — SERIOUS PRODUCT RELIABILITY

| # | Gap | Evidence | Impact | Fix | Effort |
|---|---|---|---|---|---|
| P1-1 | Self-HTTP-call for revalidation | validationLoop.js calls localhost:5173 | Revalidation fails silently if server busy | Replace with direct function call | Small |
| P1-2 | missions.json uses raw writeFileSync | missions.js line ~380 | Data corruption on crash during write | Use atomicWrite.js | Small |
| P1-3 | Webhooks in-memory only | webhooks Map in index.js | Webhook registrations lost on restart | Persist to .qase/webhooks.json | Medium |
| P1-4 | No pagination on sessions API | /api/sessions returns 427 objects | Slow frontend hydration, memory bloat | Add pagination + summary endpoint | Medium |
| P1-5 | Session pruning permanently deletes | 60s timer keeps last 50 only | Historical mission data lost | Archive instead of delete; or increase limit | Small |
| P1-6 | Silent error swallowing in frontend | `.catch(() => [])` in shared.js | Failures appear as empty data | Show error states instead | Medium |
| P1-7 | 1318 missions in "created" state | missions.json | Stale data, memory bloat | Add TTL cleanup or lazy-start timeout | Small |

### P2 — IMPORTANT PRODUCT QUALITY

| # | Gap | Evidence | Impact | Fix | Effort |
|---|---|---|---|---|---|
| P2-1 | Evidence graph unbounded growth | 9.8MB, 14K items, no pruning | Slow startup, memory bloat | Add pruning by age/mission | Medium |
| P2-2 | No global error handler | Missing in index.js | Unhandled errors crash process | Add app.use(errorHandler) | Small |
| P2-3 | Lost test files (126 tests) | ext4 corruption | Regression coverage gaps | Recreate from deliverables | Medium |
| P2-4 | findingsCount stale on missions | missions.json shows 0 findings | Incorrect data in UI/API | Update mission object on finalization | Small |
| P2-5 | No loading skeletons in frontend | UI shows empty then fills | Appears broken during load | Add CSS skeletons | Medium |
| P2-6 | BrowserStack not wired to agent | Only in replay.js | Feature advertised but not functional | Wire into browserBridge.js or hide | Medium |

### P3 — UI / POLISH

| # | Gap | Evidence | Impact | Fix | Effort |
|---|---|---|---|---|---|
| P3-1 | 49 PNG files in root | File listing | Unprofessional | Move to docs/ | Trivial |
| P3-2 | No frontend build/minification | Raw JS served | 600KB payload | Add esbuild/rollup | Medium |
| P3-3 | Duplicate documentation locations | docs/, .drytis/, userDocs/ | Confusing | Consolidate | Small |
| P3-4 | Empty recovery directories | validationLoop_corrupt.js/, _recovered.js/ | Confusing | Remove | Trivial |

### P4 — FUTURE / OPTIONAL

| # | Gap | Evidence | Impact | Fix | Effort |
|---|---|---|---|---|---|
| P4-1 | No semantic similarity for findings | Keyword/regex matching only | Misses novel defects | Add embeddings | Large |
| P4-2 | No token counting for budget | LLM calls ≈ activity count | Imprecise budget | Add token counter | Medium |
| P4-3 | No model fallback | Single model (glm-5.1) | No resilience to model outage | Add fallback chain | Medium |
| P4-4 | No rate limiting | Any consumer floods missions | DoS risk | Add express-rate-limit | Small |

---

## 27. Recommended Fixes

**Minimum work to reliably test a real application autonomously:**

1. **Fix concurrentRuns** (P0-1) — Set to 1, add browser queue for concurrent missions
2. **Add dialog handler** (P0-2) — `page.on('dialog', d => d.dismiss())` in browserBridge
3. **Secure internal API** (P0-3) — Add auth to unprotected routes
4. **Fix revalidation** (P1-1) — Replace self-HTTP-call with direct function call
5. **Fix missions.json writes** (P1-2) — Use atomicWrite.js
6. **Persist webhooks** (P1-3) — Write to .qase/webhooks.json
7. **Add pagination** (P1-4) — Limit + offset on sessions API
8. **Fix frontend errors** (P1-6) — Show error states instead of empty arrays

These 8 fixes address every P0 and the most critical P1 items.

---

## 28. Estimated Effort

| Priority | Items | Effort | Blocks autonomous? |
|---|---|---|---|
| P0 | 3 | Small-Medium | **YES** |
| P1 | 7 | Medium | Some |
| P2 | 6 | Medium | No |
| P3 | 4 | Trivial-Small | No |
| P4 | 4 | Medium-Large | No |

---

## 29. Recommended Order of Work

1. P0-1: concurrentRuns=1 + browser queue
2. P0-2: Dialog auto-dismiss handler
3. P0-3: Secure internal API routes
4. P1-1: Direct revalidation call
5. P1-2: Atomic writes for missions.json
6. P1-3: Persist webhooks
7. P1-4: Session pagination
8. P1-6: Frontend error states
9. P1-5: Session archival instead of deletion
10. P1-7: Cleanup stale "created" missions
11. P2 items as needed

---

## 30. What NOT to Build

- **Do NOT redesign the architecture** — it works
- **Do NOT add a frontend framework** — vanilla JS is fine for this scale
- **Do NOT replace JSON persistence with a database** — it's adequate
- **Do NOT add BrowserStack support to the agent** — not needed for core product
- **Do NOT add semantic/embedding-based finding detection** — keyword matching is adequate for v1
- **Do NOT add multi-tenant isolation** — single workspace is fine for standalone product
- **Do NOT add CI/CD pipeline** — tests run manually for now
- **Do NOT build a new UI** — current UI works, just needs loading states

---

## 31. Final Readiness Scores

| Category | Score | Key Issue |
|---|---|---|
| Architecture | 78/100 | Solid modular design; self-HTTP-call revalidation is fragile |
| Backend | 72/100 | Works but has security holes, error handling gaps |
| Frontend | 55/100 | Functional but no loading states, silent error swallowing |
| Persistence | 65/100 | Works but unbounded growth, raw writeFileSync risk |
| Agent/LLM | 75/100 | Works well; maxTurns=30 adequate for simple apps |
| Browser automation | 70/100 | Works; dialog handling is the weak point |
| Evidence | 85/100 | Comprehensive; just needs pruning |
| Findings | 82/100 | Good dedup + confidence; stale findingsCount issue |
| Decision engine | 88/100 | Solid deterministic policy with safety overrides |
| Revalidation | 60/100 | Works but self-HTTP-call pattern is fragile |
| Security | 50/100 | Integration API good; internal API exposed |
| UI/UX | 50/100 | Functional but appears broken during loading |
| Integration-ready | 80/100 | Clean API contract, webhook system, auth |
| Autonomous-ready | 68/100 | Core pipeline works; concurrency + dialogs block reliability |

**LOWEST scores and why they matter:**
- **Security (50)** — Internal API exposes data without auth. Any network-adjacent user can read sessions, findings, and knowledge.
- **UI/UX (50)** — Silent error swallowing makes the product appear broken. No loading states.
- **Frontend (55)** — Data staleness after reload undermines user confidence.
- **Revalidation (60)** — Self-HTTP-call can silently fail, breaking the improvement loop.

---

## FINAL VERDICT

### **B — MOSTLY READY, STABILITY WORK REQUIRED**

QASE's core autonomous pipeline works. Real missions complete with findings, evidence, quality scores, and structured reports. The architecture is sound — modular, deterministic assessment, comprehensive evidence system.

**However, QASE cannot yet RELIABLY test a real application autonomously from start to finish because:**

1. **concurrentRuns=20 with 1 browser** causes agent contention and turn-wasting
2. **No dialog handler** means alert()/confirm() in target apps derail exploration
3. **Self-HTTP-call revalidation** can silently fail
4. **Frontend silent error swallowing** makes the product appear broken

**The minimum work to fix this is small** — 3 P0 items (concurrentRuns, dialog handler, API auth) + 4 P1 items (revalidation, atomic writes, webhooks, pagination). All are well-understood, localized fixes. No architecture redesign needed.

**Answer to the key question:**

*"What prevents QASE today from reliably testing a real application autonomously from start to finish?"*

→ **Browser contention from concurrentRuns=20, JavaScript dialog blocking (alert/confirm), and fragile self-HTTP-call revalidation.** Fix these three things (all small, localized changes) and QASE can reliably complete autonomous missions on real applications.

*"What is the minimum work required to fix it?"*

→ **8 fixes total** (3 P0 + 5 P1), all small-to-medium effort, no architecture changes. The core engine, assessment pipeline, evidence system, and decision engine are all production-ready. The gaps are in reliability infrastructure, not capability.
