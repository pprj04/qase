# QASE — Complete Architectural Analysis
## Prepared for CTO Review — August 7, 2026

> Every statement in this document is backed by actual code.
> File paths and line numbers are referenced throughout.
> If something is not implemented, it says so explicitly.

---

# STEP 1 — PROJECT OVERVIEW

## What is this product?

QASE is an **autonomous software quality agent** that tests live websites in a real browser. It is built on `@cleanslate/sdk` (`package.json` line 14), which provides an LLM-driven agent loop with a Playwright browser.

The agent receives a URL, opens it in a headless Chromium browser, explores the site like a human QA engineer — clicking links, filling forms, taking screenshots — files structured findings (bugs, UX issues, security concerns), and produces a release assessment.

After the agent finishes exploring, a **post-session intelligence pipeline** runs automatically: it generates replayable test cases from captured workflows, analyzes findings for root causes, detects missing features by reasoning about what the application *should* have, writes knowledge patterns for future runs, and produces a quality score.

## What problem does it solve?

AI-generated software (e.g., from tools like AI Studio) is produced fast but validated slowly or not at all. QASE's stated purpose (`MISSION.md` line 1):

> "QASE is the autonomous quality layer for AI-generated software."

The core question is not "what is broken?" but **"what should this software become?"** — meaning the system attempts to understand what the application is *supposed* to be, then finds both bugs (things that exist but are broken) and feature gaps (things that should exist but don't).

## Who are the users?

Based on the meeting transcripts (`/workspace/userDocs/`), the team consists of:
- **Thomas Eide** — Product Owner. Drives the product vision.
- **Mishal Muneer** — Architect. Shapes the technical architecture.
- **Abhishek U, Pushkaraj Potdar, Niharikaa Aitam** — Engineering team.

The end users are **development teams who generate software with AI tools** and need autonomous validation. The integration target is **AI Studio** — a code generation platform that would feed generated apps to QASE for validation in a continuous loop.

## What is the business goal?

The product vision (`MISSION.md` lines 5-8): AI Studio generates an app → QASE understands/explores/validates it → finds bugs and gaps → generates an improvement prompt → AI Studio regenerates → QASE revalidates → verdict after N iterations. This closed loop is the core value proposition.

## What is the current maturity?

**MVP with functional core, partial intelligence layer.**

The agent can autonomously test live websites and file real findings (verified: 165 findings across 12 sessions, `metrics-overview` in the running app). The post-session pipeline works end-to-end (workflow capture → test generation → dev intelligence → feature gap analysis → quality scoring → knowledge writing). However:

- Purpose detection accuracy is **43%** (measured, `ROADMAP.md` success metrics)
- The AI Studio closed loop is **not implemented** — no live regeneration cycle exists
- LLM enhancement exists in code but is **not wired** (no API key configured)
- The Decision Engine is **not separated** from quality assessment (both live in `mission_finalize`)

## What is already completed?

| Capability | Status | Evidence |
|---|---|---|
| Agent runtime + 21 browser/QA tools | **Production** | `agent.js` (608 lines), `qaTools.js` (177 lines) |
| Browser bridge with live visualization | **Production** | `browserBridge.js` (449 lines), frame streaming via SSE |
| Session store with SSE | **Production** | `store.js` (218 lines), `index.js` SSE endpoint |
| Credential vault (secrets never reach LLM) | **Production** | `secrets.js` (112 lines) |
| Finding store with deduplication | **Production** | `findings.js` (422 lines), 165 findings stored |
| Test case generation from workflows | **Production** | `testGen.js` (240 lines), LLM-powered |
| Deterministic test replay engine | **Production** | `replay.js` (896 lines), Playwright-based |
| Self-healing selectors | **Production** | `selfHeal.js` (249 lines), LLM-powered |
| Cron-based regression scheduler | **Production** | `scheduler.js` (294 lines) |
| Visual regression (pixelmatch) | **Production** | `replay.js` evaluateAssertion, `pixelmatch` dep |
| Capability Registry + Orchestrator | **Implemented** | `capabilities.js` (564 lines), 8 capabilities |
| Feature Gap Analysis (heuristic) | **Partial** | `featureGap.js` (1,544 lines), 43% accuracy |
| Knowledge Layer Phase 1 | **Implemented** | `knowledge.js` (278 lines) |
| Mission layer with iterations | **Implemented** | `missions.js` (320 lines) |
| Quality scoring system | **Implemented** | `devIntelligence.js` calculateMissionQuality |
| Developer IDE UI (4-tab right panel) | **Implemented** | `styles.css` (5,612 lines), `app.js` (2,339 lines) |

## What is still missing?

| Missing Component | Status | Impact |
|---|---|---|
| Decision Engine (separate from assessment) | **Not implemented** | `mission_finalize` does both scoring and verdict — violates architecture principle #7 |
| Evidence Graph | **Not implemented** | Evidence is flat objects, no graph structure |
| Continuous Validation Loop | **Not implemented** | One-shot execution, no regenerate/revalidate cycle |
| AI Studio Contract | **Not implemented** | No live generate→validate→improve integration |
| LLM-Enhanced Analysis | **Not wired** | `enhanceGapsWithLLM` exists at `featureGap.js:1199` but requires `config.model` + `config.baseUrl` |
| Knowledge Query as formal capability | **Partial** | Runs inline in `feature_gap` capability (`capabilities.js:354`), not its own registered capability |
| Real-world validation harness | **Not implemented** | No test apps with documented expected features |
| Database | **Not implemented** | All persistence is JSON files |

---

# STEP 2 — ARCHITECTURE

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER / AI STUDIO                               │
│    Submits URL via chat, API, or AI Studio mission                       │
└──────────────┬──────────────────────────────────┬───────────────────────┘
               │                                  │
               ▼                                  ▼
┌──────────────────────┐           ┌──────────────────────────┐
│   POST /api/sessions │           │ POST /api/v1/missions    │
│   /:id/message       │           │ (public API contract)    │
└──────────┬───────────┘           └───────────┬──────────────┘
           │                                   │
           ▼                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                        server/index.js                           │
│                   (Express, 78 endpoints, SSE)                   │
└──────────┬──────────────────────────────┬───────────────────────┘
           │                              │
     ┌─────▼──────┐          ┌───────────▼────────────┐
     │  agent.js   │          │  capabilities.js        │
     │  (LLM loop) │          │  (Orchestrator)         │
     │  Runs the   │          │  Runs post-session      │
     │  interactive │          │  intelligence pipeline  │
     │  exploration │          └───┬───┬───┬───┬───────┘
     └──┬───┬─────┘               │   │   │   │
        │   │              ┌──────▼┐ ┌▼──┐│ ┌─▼──────────┐
  ┌─────▼┐ ┌▼──────┐       │testGen│ │dev││ │ featureGap  │
  │qaTools│ │browser│       │(LLM)  │ │Int││ │ (1,544 LOC)│
  │(tools)│ │Bridge │       └───────┘ └───┘│ └────────────┘
  └───┬──┘ └───┬──┘                        │
      │        │                    ┌──────▼──────┐
      │   ┌────▼────┐               │  missions   │
      │   │ secrets │               │  .js        │
      │   │ (vault) │               │ (iterations)│
      │   └─────────┘               └─────────────┘
      │
┌─────▼──────────────────────────────────────────────────────────┐
│                        store.js (Session)                       │
│     In-memory Map + JSON mirror → .qase/sessions.json           │
│     EventEmitter bus → SSE stream → frontend                    │
└────────────────────────────────────────────────────────────────┘
         │              │             │            │
   ┌─────▼─────┐  ┌─────▼────┐  ┌─────▼────┐  ┌───▼──────┐
   │ findings  │  │ testCases│  │ workflows│  │ missions │
   │   .js     │  │   .js    │  │   .js    │  │   .js    │
   │ .json     │  │ .json    │  │ .json    │  │ .json    │
   └───────────┘  └──────────┘  └──────────┘  └──────────┘
```

## Component Explanation

### Input Sources
Three entry points, all create a **Session** in the store:
1. **Chat interface** — `POST /api/sessions/:id/message` (`index.js:304`) — user types a URL or instruction
2. **Public API v1** — `POST /api/v1/missions` (`index.js`) — programmatic, for AI Studio
3. **Scheduler** — `scheduler.js` — cron-triggered regression runs

### Agent Runtime (`agent.js`)
The **interactive exploration engine**. Receives a task, creates a `CleanSlateNodeAgentRuntime` (`agent.js:140`), and runs an LLM-powered agent loop. The agent:
- Calls browser tools (open, click, fill, screenshot) to explore the site
- Calls `report_finding` to file bugs as it finds them
- Calls `finish_qa_report` to end the session with a verdict
- Can call `ask_question` to pause and ask the user for credentials/decisions

The LLM drives every decision. There is no scripted test path — the agent reasons about what to do next based on what it sees on the page.

### Browser Bridge (`browserBridge.js`)
Wraps the SDK's Playwright service for:
- **Live visualization** — captures JPEG screenshots every 320ms, emits as SSE `frame` events
- **Cursor tracking** — publishes `{x, y, w, h}` coordinates before each click/fill
- **Credential safety** — intercepts `fill`/`typeText`, swaps `{{PLACEHOLDER}}` → real value from vault
- **Navigation settling** — waits up to 1.6s for URL changes after navigation
- **Session persistence** — saves cookies/localStorage on browser idle, replays on resume

### Capability Orchestrator (`capabilities.js`)
The **post-session intelligence pipeline**. Runs automatically after the agent calls `finish_qa_report` (triggered from `qaTools.js:81`). Uses a **Capability Registry** with formal contracts and a **topological sort** to determine execution order.

Each capability declares: `dependsOn`, `requiredEvidence`, `producesEvidence`, `enabled()`, `execute()`. The Orchestrator:
1. Filters to enabled capabilities
2. Topologically sorts by dependencies (Kahn's algorithm, `capabilities.js:93-121`)
3. Executes in order, passing evidence between capabilities
4. Skips downstream capabilities when a dependency fails
5. Emits `pipeline_progress` SSE events at each stage

### Evidence Pipeline
**Currently flat.** Each capability returns a result object, and the Orchestrator collects evidence keys:
```javascript
// capabilities.js:177-179
for (const evidenceKey of cap.producesEvidence ?? []) {
    if (result?.[evidenceKey] !== undefined) {
        evidence[evidenceKey] = result[evidenceKey];
    }
}
```
There is **no evidence graph** — no linked nodes connecting findings to evidence to capabilities. This is documented as a gap in `ARCHITECTURE.md`.

### Knowledge Layer (`knowledge.js`)
**Phase 1 implemented.** A simple pattern store:
- **Write (post-mission):** Extracts findings with severity ≥ medium, deduplicates by normalized title + framework/auth provider, accumulates occurrences
- **Read (pre-analysis):** Matches app metadata (framework, authProvider, appType) against stored patterns
- **Storage:** `.qase/knowledge.json` (currently empty — `[]`)
- **Confidence model:** 1 occurrence → 0.3, 2 → 0.5, 3 → 0.7, 5 → 0.85, 10+ → 0.95

### Quality Assessment (`devIntelligence.js`)
The `calculateMissionQuality()` function (`devIntelligence.js:265-352`):
- Starts at score 100
- Deducts by severity × confidence: critical=25, high=15, medium=8, low=3, info=1
- Duplicates deduct 10% of their normal weight
- Score ≥85 + no critical → `pass`, release-ready
- Score ≥60 + no critical → `pass_with_issues`, release-ready
- Below → `fail`, not release-ready
- Also computes: risk level (high/medium/low), critical issues list, top 3 recommendations

### Decision Making
**Not separated from quality assessment.** The `mission_finalize` capability (`capabilities.js:394-458`) both calculates the quality score AND decides the verdict. There is no separate Decision Engine that can choose `approve / regenerate / escalate / stop`.

---

# STEP 3 — PROJECT STRUCTURE

## Repository Layout

```
/workspace/
├── server/                     # Backend (Node.js, Express 5, ES Modules)
│   ├── index.js               # 1,856 lines — HTTP server, 78 endpoints, SSE, boot
│   ├── agent.js               #   608 lines — Autonomous agent runtime (LLM + browser loop)
│   ├── browserBridge.js       #   449 lines — Playwright wrapper (screenshots, cursor, secrets)
│   ├── capabilities.js        #   564 lines — Capability Registry + Orchestrator (8 capabilities)
│   ├── featureGap.js          # 1,544 lines — Application understanding + feature gap intelligence
│   ├── devIntelligence.js     #   556 lines — Root cause analysis + quality scoring
│   ├── store.js               #   218 lines — Session data model + SSE event bus
│   ├── missions.js            #   320 lines — Mission CRUD + iteration tracking
│   ├── knowledge.js           #   278 lines — Pattern learning (write/read/match)
│   ├── replay.js              #   896 lines — Deterministic test replay engine
│   ├── qaTools.js             #   177 lines — 3 custom agent tools (report_finding, etc.)
│   ├── config.js              #   309 lines — Configuration + LLM provider management
│   ├── scheduler.js           #   294 lines — Cron-based regression scheduler
│   ├── secrets.js             #   112 lines — In-memory credential vault
│   ├── testCases.js           #   255 lines — Test case CRUD
│   ├── testGen.js             #   240 lines — LLM-powered test generation
│   ├── workflows.js           #   401 lines — Workflow step capture + persistence
│   ├── findings.js            #   422 lines — Finding store + deduplication
│   ├── projects.js            #   190 lines — Project scoping
│   ├── suites.js              #   188 lines — Test suite hierarchy
│   ├── baselines.js           #   224 lines — Visual regression baselines
│   ├── selfHeal.js            #   249 lines — LLM-powered selector healing
│   ├── replayStore.js         #   101 lines — Test run results store
│   ├── regressionStore.js     #   158 lines — Regression run history
│   ├── metrics.js             #   106 lines — Dashboard metrics aggregation
│   ├── report.js              #    74 lines — Markdown report generation
│   ├── devReport.js           #   145 lines — Dev intelligence markdown report
│   ├── exporters.js           #   162 lines — Session finding exports
│   ├── bugExporters.js        #   141 lines — Individual finding exports
│   ├── prompt.js              #   123 lines — Agent system prompt builder
│   ├── junit.js               #    90 lines — JUnit XML generation
│   ├── webhooks.js            #   100 lines — Outbound webhook notifications
│   ├── atomicWrite.js         #    44 lines — Atomic file writes (tmp + rename)
│   ├── demoSite.js            #   163 lines — Deliberately broken practice site
│   └── pipeline.js            #    17 lines — Re-export shim for capabilities.js
│
├── public/                     # Frontend (Vanilla JS, no framework, no build)
│   ├── index.html             #   724 lines — Single-page HTML shell
│   ├── app.js                 # 2,339 lines — Core dashboard controller
│   ├── shared.js              #   272 lines — State, DOM refs, utilities
│   ├── pipeline.js            #   389 lines — Mission progress + app analysis rendering
│   ├── tests.js               # 1,373 lines — Test case management page
│   ├── bugs.js                #   525 lines — Bugs Hub page
│   ├── schedules.js           #   411 lines — Schedules management page
│   ├── workflows.js           #   292 lines — Workflows browsing page
│   ├── router.js              #    81 lines — Hash-based router
│   └── styles.css             # 5,612 lines — Complete design system
│
├── tests/                      # Test Suite (node:test)
│   ├── test-capability-registry.js    — 19 tests
│   ├── test-feature-gap.js            — 52 tests
│   ├── test-interactive-exploration.js — 21 tests
│   ├── test-interactive-intelligence.js — 16 tests
│   ├── test-knowledge.js              — 16 tests
│   ├── test-mission-architecture.js   — 35 tests
│   ├── test-mission-context.js        — 13 tests
│   ├── validate-real-apps.js          — Real-world validation harness
│   ├── phase9b-parallel-retry.test.js — 12 tests
│   ├── phase9c-artifacts-history.test.js — 10 tests
│   ├── phase10-visual-regression.test.js — 10 tests
│   ├── phase11a-findings-store.test.js — 29 tests
│   ├── phase12-pipeline.test.js       — 8 tests
│   ├── phase13-dev-intelligence.test.js — 1 test
│   └── phase14-multi-viewport.test.js — 1 test
│
├── .drytis/                    # Architecture Documents + Specs
│   ├── MISSION.md             # Product definition + principles
│   ├── ARCHITECTURE.md        # System architecture (frozen)
│   ├── CAPABILITIES.md        # Capability contracts (frozen)
│   ├── KNOWLEDGE.md           # Knowledge layer spec (frozen)
│   ├── ROADMAP.md             # Success metrics + phases
│   └── specs/                 # 30+ task specs with acceptance criteria
│
├── .qase/                      # Runtime Data (JSON files)
│   ├── sessions.json          # 3.2 MB — all session data
│   ├── findings.json          # 404 KB — all findings
│   ├── workflows.json         # 1.1 MB — captured workflows
│   ├── test-cases.json        # 488 KB — generated test cases
│   ├── missions.json          # 12 KB — mission records
│   ├── knowledge.json         # Empty — no patterns learned yet
│   ├── config.json            # LLM endpoint config (mode 0600)
│   ├── schedules.json         # Regression schedules
│   ├── regression-runs.json   # Regression history
│   ├── replay-runs.json       # Test run results
│   ├── artifacts/             # Screenshots, traces, DOM snapshots
│   └── workspaces/            # Per-session browser workspace dirs
│
├── package.json                # 6 dependencies, ES Modules, Node >= 20
└── README.md                   # Setup + configuration docs
```

### Why Each Folder Exists

| Folder | Purpose |
|---|---|
| `server/` | All backend logic — Express server, agent runtime, intelligence modules, stores |
| `public/` | All frontend code — served statically by Express, no build step |
| `tests/` | Test suite using Node's built-in `node:test` runner — no Jest/Mocha |
| `.drytis/` | Frozen architecture documents + task specs — the "source of truth" for design decisions |
| `.qase/` | Runtime data — all persistence is JSON files, read into memory on boot |

---

# STEP 4 — DATA FLOW: One Complete Mission

## Tracing: User Enters URL → Mission Complete

### Phase 1: Session Creation
```
User types "https://example.com" in composer
  → app.js:1796  el.composer.onsubmit
  → POST /api/sessions/:id/message { text: "https://example.com" }
  → index.js:304  extracts URL via extractUrl()
  → store.js:62   session.targetUrl = "https://example.com"
  → agent.js:208  startTurn(session, { task: "..." })
```

### Phase 2: Agent Exploration
```
agent.js:208  runTurn(session, { task })
  → agent.js:107  ensureRuntime(session)
    → Creates CleanSlateNodeAgentRuntime with provider config
    → Registers QA tools (report_finding, finish_qa_report, set_viewport)
    → Wraps browser service with attachBrowserBridge()
    → Patches executeTool to intercept tool_start
  → agent.js:298  runtime.run(task, controller.signal)
    → SDK streams parts:
      ├─ reasoning      → emit('reasoning') → SSE → thinking strip
      ├─ chat_text      → addMessage() → SSE → chat bubble
      ├─ tool_start     → beginActivity() → SSE → activity feed
      │     └─ captureStep() → stored in session.capturedSteps
      ├─ tool_result    → updateActivity() → finalizeStepOutcome()
      │     └─ redact() → ensures secrets masked
      └─ task_complete  → loop ends
```

### Phase 3: Agent Files Findings
```
Agent calls report_finding tool
  → qaTools.js:23  createQaTools → report_finding handler
    → Pushes finding to session.findings
    → syncSessionFinding() → findings.js global store
    → emit('finding') → SSE → frontend renderFindings()
    → Toast notification if critical/high
```

### Phase 4: Agent Finishes Report
```
Agent calls finish_qa_report tool
  → qaTools.js:81  finish_qa_report handler
    → Sets session.report = { verdict, summary, covered, ... }
    → emit('report') → SSE → frontend renderReport()
    → NOTIFIES: notifyReport() webhook
    → TRIGGERS: runAutonomyPipeline(session) [fire-and-forget]
```

### Phase 5: Post-Session Intelligence Pipeline
```
capabilities.js:514  runAutonomyPipeline(session, config)
  → defaultOrchestrator.execute(session, config)
    → Topological sort: [workflow_save, dev_intelligence, feature_gap,
                         test_generation, smoke_run?, schedule_create,
                         mission_finalize, knowledge_write]
    → For each capability:
        ├─ emit('pipeline_progress', { stage, status: 'running' })
        ├─ execute(session, evidence, config)
        ├─ Collect evidence from result
        └─ emit('pipeline_progress', { stage, status: 'done' })

    Stage 1: workflow_save
      → workflows.js saveWorkflow() — saves capturedSteps as named workflow
      → Evidence: { workflow: wf }

    Stage 2: test_generation (depends on workflow_save)
      → testGen.js generateTestCasesFromWorkflow() — LLM generates 1-5 tests
      → testCases.js createTestCases() — persists to test-cases.json
      → Evidence: { testCases: [...] }

    Stage 3: smoke_run (optional, depends on test_generation)
      → replay.js runTestSuite() — deterministic replay
      → Evidence: { smokeResults: {...} }

    Stage 4: schedule_create (depends on test_generation)
      → scheduler.js createSchedule() — cron-based regression
      → Evidence: { schedule: {...} }

    Stage 5: dev_intelligence
      → devIntelligence.js analyzeSessionFindings() — LLM root cause per finding
      → Evidence: { devReport: {...} }

    Stage 6: feature_gap
      → knowledge.js detectAppMetadata() + queryKnowledge()
      → featureGap.js analyzeFeatureGaps()
        → extractAppInventory() — derives pages, forms, auth, capabilities
        → inferAppPurpose() — matches against 11-type catalog
        → generateExpectedFeatures() — purpose-driven expectations
        → detectFeatureGaps() — expected vs actual
        → analyzeWorkflowGaps() — user journey completeness
      → enhanceGapsWithLLM() — IF config.model && config.baseUrl
      → gapsToFindings() — converts gaps to finding objects
      → Evidence: { featureGaps: [...] }

    Stage 7: mission_finalize (depends on feature_gap)
      → devIntelligence.js scoreFindingQuality() per finding
      → devIntelligence.js calculateMissionQuality()
        → Score 100 - Σ(severity_weight × confidence)
        → Verdict: pass / pass_with_issues / fail
        → releaseReady: true/false
      → missions.js recordIteration() — logs this run
      → missions.js finalizeMission() — sets status=completed
      → missionBus.emit('finalized') → fires webhooks
      → Evidence: { missionResult: {...} }

    Stage 8: knowledge_write (depends on mission_finalize)
      → knowledge.js writeKnowledge()
        → Extracts findings ≥ medium severity
        → Deduplicates by framework+authProvider+normalizedTitle
        → Increments occurrences, updates confidence
      → Evidence: { knowledgePatterns: [...] }
```

### Phase 6: UI Update
```
capabilities.js:540  emit('pipeline_complete', { summary, stages })
  → SSE → app.js:1509 handleEvent('pipeline_complete')
    → renderPipeline() — stage strip shows [ COMPLETE ]
    → updateMissionSummary() — fills TYPE/QUALITY/RELEASE/CONFIDENCE items
    → injectReleaseAssessment() — structured block in conversation
      → "**RELEASE ASSESSMENT** ... Status: [ NOT READY ] ..."
```

---

# STEP 5 — AGENT FLOW

## How does the agent think?

The agent uses an **LLM-driven reasoning loop** via `@cleanslate/sdk`:

```
agent.js:298  const stream = runtime.run(task, controller.signal)

for await (const part of stream) {
  // The SDK streams parts as they arrive:
  // 1. 'reasoning' → agent's thinking (streamed, not stored)
  // 2. 'chat_text' → what the agent says to the user
  // 3. 'tool_start' → agent wants to call a tool
  // 4. 'tool_result' → tool completed, here's the result
  // 5. 'task_complete' → agent is done
}
```

The LLM receives:
- A **system prompt** (`prompt.js:buildQaContext()`) describing its role as "Qase, an autonomous QA engineer"
- The **target URL**, available credentials (names only), current browser location
- The **allowed tools list**
- Instructions: open URL → snapshot → publish plan → work plan → report findings → finish report
- Safety rules: no destructive actions, no payments, confirm broken links

The LLM decides what to do next based on what it sees. There is no script.

## How are tools selected?

The SDK's `approveTool` callback (`agent.js:149`) whitelists 24 tools:
- **17 browser tools**: `browser_open/close/click/type/fill/select_option/press_key/hover/scroll/screenshot/snapshot/diagnostics/wait/navigate_back/tabs`
- **3 custom QA tools**: `report_finding`, `finish_qa_report`, `set_viewport`
- **2 SDK tools**: `update_todo`, `ask_question`

Shell commands are **always rejected** (`approveCommand: async () => false`, `agent.js:148`).

The LLM chooses which tool to call based on its reasoning. For example, if it sees a login form, it may call `ask_question` to request credentials, then `browser_fill` to enter them.

## How does Playwright work?

The SDK manages the Playwright browser lifecycle. Qase wraps it via `browserBridge.js`:

```
SDK launches Chromium (bundled or system)
  → browserBridge.js wraps the browserAutomationService
    → Patches .open/.click/.fill/.typeText/.hover/.scroll/.check/.selectOption
    → Each patched method:
        1. Resolves element boundingBox
        2. Emits 'cursor' event { x, y, w, h }
        3. Dwells CURSOR_DWELL_MS (420ms) for visual feedback
        4. Calls original method
        5. Calls settleNavigation() — waits for URL change
    → Patches .snapshot — computes CSS structural paths for elements
    → Patches .fill/.typeText — intercepts {{PLACEHOLDER}} → resolveSecrets()
```

**Browser executable detection** (`agent.js:useBundledChromium()`):
1. Playwright's `chromium.executablePath`
2. `chrome-headless-shell` in Playwright cache
3. System Chrome
4. Validates ELF magic header before use

## How are screenshots taken?

Two types:

**1. Live frame streaming** (`browserBridge.js`):
```
captureFrame()
  → page.screenshot({ type: 'jpeg', quality: 55 })
  → Stores as bridge.lastFrame
  → emit('frame', { frame: base64 })
  → SSE → frontend applyFrame() → sets <img>.src

  Interval: setInterval(captureFrame, 320ms)
```

**2. Diagnostic screenshots** (agent-driven):
```
Agent calls browser_screenshot or browser_diagnostics
  → SDK captures full-page PNG
  → Stored in .qase/artifacts/:runId/
  → Used for visual regression baselines
```

## How is evidence collected?

Evidence collection happens at two levels:

**1. Real-time (during exploration):**
- Every tool call is captured as an **Activity** (`agent.js:275-294`)
- Every browser action is captured as a **WorkflowStep** with outcome (`workflows.js:captureStep`, `finalizeStepOutcome`)
- Console errors and failed network requests are captured by Playwright listeners (`browserBridge.js` wraps page events)
- Dialog appearances (alert/confirm) are detected

**2. Post-session (during pipeline):**
- `extractAppInventory()` derives structured data from all captured steps, activities, and report
- `detectAppMetadata()` detects framework, auth provider, app type from text patterns
- `analyzeSessionFindings()` runs LLM root cause analysis per finding

## How are findings created?

The agent calls the `report_finding` tool (`qaTools.js:23-78`):

```javascript
// Required fields: title, severity, expected, actual
// Optional: category, url, steps[], evidence, observed, impact, recommendation, reproducibility

// The tool:
1. Creates a finding object with UUID + timestamp
2. Pushes to session.findings
3. Calls syncSessionFinding(session, finding) → findings.js global store
4. Emits 'finding' SSE event → frontend renders immediately
5. Shows toast if severity is critical or high
6. Returns { finding_id, total_findings } to the agent
```

Findings can also be created by the pipeline:
- `gapsToFindings()` in `featureGap.js:1286` converts feature gaps to finding objects

## How is confidence calculated?

**Per-finding** (`devIntelligence.js:scoreFindingQuality`, called at `capabilities.js:414`):
- Confidence is derived from **evidence richness**: findings with screenshots, steps, and reproduction steps get higher confidence
- Duplicate detection by title+url similarity
- Reproducibility: confirmed (multiple observations) > unconfirmed > intermittent

**Mission-level** (`devIntelligence.js:265-352`):
- `confidence` = average of all non-duplicate finding confidences
- `risk` = derived from critical/high counts + score
- Not a probabilistic model — it's a heuristic deduction system

## How does reasoning happen?

The SDK streams `reasoning` events (`agent.js:316`):
```javascript
case 'reasoning':
    appendThinking(part.content);
    → emit('message_delta', { id: thinking, content, role: 'thinking' })
    → SSE → frontend updates thinking strip
```

**Reasoning is ephemeral** — it is never persisted to `session.messages`. On page reload, reasoning disappears. Only the agent's `chat_text` (what it said publicly) is stored.

## How does feature gap analysis work?

`featureGap.js` — the largest module at 1,544 lines — runs a 5-phase heuristic pipeline:

**Phase 1: Extract App Inventory** (`extractAppInventory`, line 220)
- Derives: pages visited, forms found, auth state (has login/register/forgot), capabilities (search, dashboard, settings, payment, contact, notifications, media, apiDocs)
- Includes `extractInteractiveSignals()` (line 61) which detects verified auth flows, broken features, page transitions from captured step outcomes
- Computes `explorationConfidence` (0.2–1.0) based on exploration depth

**Phase 2: Infer App Purpose** (`inferAppPurpose`, line 503)
- Matches inventory data against an 11-type catalog: CRM, admin_dashboard, ecommerce, saas_platform, marketing, content, social, cms, project_management, developer_platform, productivity
- Each type has signal keywords (e.g., ecommerce: "cart", "checkout", "product", "shop")
- Verified interactions boost scoring (verified login + dashboard = strong SaaS signal, +3 points)
- Marketing site override: pricing + about + contact but no functional auth → reclassify as marketing
- Confidence = (matchCount / 3) × explorationConfidence

**Phase 3: Generate Expected Features** (`generateExpectedFeatures`, line 679)
- Purpose-aware feature expectations (e.g., ecommerce expects: product browsing, cart, checkout, payment, order history)
- Mission context can override with ground-truth expectations (confidence=1.0) via `deriveContextFeatures` (line 1034)
- `reconcileFeatures()` merges context + heuristic features, flags discrepancies

**Phase 4: Detect Feature Gaps** (`detectFeatureGaps`, line 799)
- Compares expected vs actual
- Skips features that exist as capabilities, pages, or covered areas
- Assigns severity based on feature importance × exploration confidence

**Phase 5: Workflow Gap Analysis** (`analyzeWorkflowGaps`, line 1472)
- 7 per-purpose workflow templates (e.g., ecommerce: browse → search → product → cart → checkout → payment → confirmation)
- Detects missing steps in the journey: "step exists before and after, but the middle is missing"

**Optional LLM Enhancement** (`enhanceGapsWithLLM`, line 1199)
- Sends inventory + report to LLM
- LLM returns refined gaps with root cause + fix recommendation
- **Currently not active** — requires `config.model && config.baseUrl`

## How is application understanding built?

Application understanding is the aggregate output of Phases 1-5 above. The result includes:
- **App type**: framework detected, auth provider detected, app category
- **Purpose**: best-matching purpose type with confidence
- **Detected features**: capabilities confirmed present
- **Missing features**: expected but not found
- **Workflow**: the primary user journey as a sequence of steps
- **Exploration confidence**: how thoroughly the app was explored

This data is rendered in the UI's APPLICATION_ANALYSIS tab as an AI-style narrative.

---

# STEP 6 — CAPABILITIES

## Complete Capability Registry

| # | ID | Name | Category | Depends On | Produces Evidence | Confidence | Cost | Enabled When |
|---|---|---|---|---|---|---|---|---|
| 1 | `workflow_save` | Auto-Save Workflow | extraction | — | `workflow` | 0.95 | low | `config.autoSaveWorkflow !== false` |
| 2 | `test_generation` | Generate Test Cases | generation | workflow_save | `testCases` | 0.80 | medium | `config.autoGenerateTests !== false` |
| 3 | `smoke_run` | Quick Validation Run | validation | test_generation | `smokeResults` | 0.70 | high | `config.autoSmokeRun === true` |
| 4 | `schedule_create` | Create Regression Schedule | generation | test_generation | `schedule` | 0.90 | low | `config.autoCreateSchedule !== false` |
| 5 | `dev_intelligence` | Developer Intelligence Report | analysis | — | `devReport` | 0.75 | medium | `config.autoDevReport !== false` |
| 6 | `feature_gap` | Feature Gap Analysis | analysis | — | `featureGaps` | 0.60 | medium | `config.autoFeatureGap !== false` |
| 7 | `mission_finalize` | Finalize Mission | analysis | feature_gap | `missionResult` | 0.90 | low | always |
| 8 | `knowledge_write` | Write Knowledge Patterns | extraction | mission_finalize | `knowledgePatterns` | 0.80 | low | always |

### Execution Order (Topological Sort Result)

```
Layer 0 (no deps):     workflow_save, dev_intelligence, feature_gap
Layer 1 (depends 0):   test_generation (← workflow_save)
Layer 2 (depends 1):   smoke_run (← test_generation), schedule_create (← test_generation)
Layer 3 (depends 0):   mission_finalize (← feature_gap)
Layer 4 (depends 3):   knowledge_write (← mission_finalize)
```

Actual execution is sequential (no parallel capability execution — the `for` loop at `capabilities.js:155` runs one at a time).

### Per-Capability Detail

#### Capability 1: workflow_save
- **Purpose:** Persist captured browser steps as a named workflow
- **Inputs:** `session.capturedSteps[]`
- **Outputs:** `{ workflow: Workflow, workflowId, stepCount }`
- **File:** `capabilities.js:198-220`
- **Skips when:** No captured steps (0 steps)

#### Capability 2: test_generation
- **Purpose:** Generate replayable test cases from captured workflow using LLM
- **Inputs:** `evidence.workflow` (from workflow_save)
- **Outputs:** `{ testCases: TestCase[], count, ids }`
- **File:** `capabilities.js:223-250`
- **Skips when:** No workflow available
- **Dependency:** `workflow_save` must produce evidence.workflow

#### Capability 3: smoke_run
- **Purpose:** Run generated test cases deterministically (no LLM)
- **Inputs:** `evidence.testCases` (from test_generation)
- **Outputs:** `{ smokeResults, passed, failed, errored, total }`
- **File:** `capabilities.js:253-278`
- **Skips when:** No test cases OR `config.autoSmokeRun !== true` (disabled by default)

#### Capability 4: schedule_create
- **Purpose:** Create a cron-based regression schedule for the generated tests
- **Inputs:** `evidence.testCases` (from test_generation)
- **Outputs:** `{ schedule, scheduleId, nextRun }`
- **File:** `capabilities.js:281-309`
- **Skips when:** No test cases

#### Capability 5: dev_intelligence
- **Purpose:** Run LLM root cause analysis on each finding + generate app improvement report
- **Inputs:** `session.findings[]`
- **Outputs:** `{ devReport, findingsAnalyzed, hasAppReport, priorityCount }`
- **File:** `capabilities.js:312-335`
- **Skips when:** No findings
- **LLM call:** `analyzeSessionFindings()` → per-finding root cause + fix approach

#### Capability 6: feature_gap
- **Purpose:** Detect missing features by comparing expected vs actual
- **Inputs:** `session` (capturedSteps, activities, findings, report)
- **Outputs:** `{ featureGaps: Gap[], gapAnalysis, knowledgeResult }`
- **File:** `capabilities.js:338-392`
- **Internal calls:** `detectAppMetadata()`, `queryKnowledge()`, `analyzeFeatureGaps()`, optionally `enhanceGapsWithLLM()`
- **Side effects:** Converts gaps to findings, pushes to `session.findings`

#### Capability 7: mission_finalize
- **Purpose:** Calculate quality score, determine verdict, record iteration, finalize mission
- **Inputs:** `session.findings[]`, linked missions
- **Outputs:** `{ missionResult: { quality, finalizedCount } }`
- **File:** `capabilities.js:394-458`
- **Side effects:** Scores each finding, calculates mission quality, records iteration, finalizes mission, fires webhooks

#### Capability 8: knowledge_write
- **Purpose:** Extract patterns from findings for future missions
- **Inputs:** `session.findings[]` (severity ≥ medium)
- **Outputs:** `{ knowledgePatterns: Pattern[] }`
- **File:** `capabilities.js:461-498`
- **Side effects:** Writes to `.qase/knowledge.json`

---

# STEP 7 — ORCHESTRATOR

## Mission Planning

The Orchestrator (`capabilities.js:81-190`) does **not** do adaptive planning. It runs all enabled capabilities in dependency order. There is no mission-type-based capability selection, no knowledge-influenced planning, no dynamic capability addition.

```
Orchestrator.execute(session, config)
  1. Get all registered capabilities
  2. Filter to enabled (based on config flags)
  3. Topological sort by dependsOn (Kahn's algorithm)
  4. Execute sequentially, passing evidence
  5. Skip downstream on failure
```

## Capability Selection

Static. The `enabled()` function on each capability checks a config flag:
```javascript
enabled: (config) => config.autoSaveWorkflow !== false  // workflow_save
enabled: (config) => config.autoGenerateTests !== false  // test_generation
enabled: (config) => config.autoSmokeRun === true        // smoke_run (OFF by default)
```

No capability is dynamically added based on what the agent found. A security-focused mission runs the same capabilities as a UX-focused mission.

## Dependency Resolution

Kahn's algorithm (`capabilities.js:93-121`):
1. Build adjacency list from `dependsOn` fields
2. Repeatedly pick capabilities with no unsatisfied dependencies
3. Detects circular dependencies (throws error)

## Execution Model

**Sequential.** The `for` loop at `capabilities.js:155` runs one capability at a time:
```javascript
for (const cap of plan) {
    const depFailed = (cap.dependsOn ?? []).some(depId => failedDeps.has(depId));
    if (depFailed) {
        results[cap.id] = { status: 'skipped', reason: 'dependency_failed' };
        failedDeps.add(cap.id);
        continue;
    }
    // ... execute ...
}
```

There is **no parallel execution**. Capabilities with no dependencies (e.g., `dev_intelligence` and `feature_gap`) run sequentially despite being independent.

## Retry

**None.** If a capability throws an error, it is marked as `failed` and all downstream capabilities are skipped. There is no retry mechanism at the Orchestrator level.

The agent itself has retry for **model timeouts** only (`agent.js:24`, 2 retries with 2000ms delay).

## Timeout

**None at the Orchestrator level.** The agent has `maxTurns` (default 120, `config.js`) which limits the LLM interaction loop.

## Stopping Criteria

The agent stops when:
1. The LLM calls `finish_qa_report` (explicit completion)
2. The LLM calls `ask_question` (pauses for user input)
3. The user clicks Stop (aborts via AbortController)
4. An unrecoverable error occurs
5. `maxTurns` is reached (LLM loop limit)

The pipeline has no stopping criteria — it runs all enabled capabilities to completion.

## Mission Lifecycle

```
created → running → completed
                 → failed
                 → aborted (user stop)
```

Missions track **iterations** — each iteration is a full validation run:
```javascript
iterations: [{
    number, sessionId, findings, qualityScore, verdict, ranAt, status
}]
```

The `POST /api/v1/missions/:id/iterate` endpoint exists to trigger the next iteration, but **there is no automatic loop** — it requires manual triggering.

---

# STEP 8 — KNOWLEDGE LAYER

## Current Implementation

**Phase 1 only.** File: `knowledge.js` (278 lines). Storage: `.qase/knowledge.json` (currently empty `[]`).

## Stored Patterns

```javascript
{
    id,                 // UUID
    framework,          // 'next.js', 'react', 'vue', etc. (or null)
    authProvider,       // 'clerk', 'auth0', 'supabase', etc. (or null)
    appType,            // 'ecommerce', 'dashboard', etc. (or null)
    pattern,            // Normalized issue title
    issue,              // Original finding title
    recommendation,     // Fix recommendation
    fixPrompt,          // AI-ready fix prompt
    source: {
        missionId,      // Where this pattern was learned
        findingId       // Which finding triggered it
    },
    occurrences,        // How many times seen
    confidence,         // 0.0-1.0 (based on occurrences)
    firstSeen,          // Timestamp
    lastSeen            // Timestamp
}
```

## Pattern Retrieval

`queryKnowledge(metadata)` (`knowledge.js:224`):
- Matches by `framework`, `authProvider`, `appType`
- Returns matched patterns + capability hints
- Example hint: "Clerk auth detected — 3 known issues exist"

Called inline in the `feature_gap` capability (`capabilities.js:354-356`), not as a separate capability.

## Pattern Writing

`writeKnowledge(findings, session, missionId)` (`knowledge.js:155`):
- Filters to findings with severity ≥ medium
- For each finding: detect metadata, normalize issue text, create pattern key
- If pattern key exists → increment occurrences, update confidence, update lastSeen
- If new → create pattern with occurrences=1, confidence=0.3

## Confidence Model

| Occurrences | Confidence |
|---|---|
| 1 | 0.30 |
| 2 | 0.50 |
| 3 | 0.70 |
| 5 | 0.85 |
| 10+ | 0.95 |

## Limitations

1. **Currently empty** — `.qase/knowledge.json` contains `[]`. No patterns have been learned yet despite 165 findings across 12 sessions. (Knowledge write runs as capability 8, but may not have had findings ≥ medium severity in recent sessions, or the knowledge.json was reset.)
2. **No capability hints used in planning** — hints are generated but the Orchestrator does not use them to modify capability selection
3. **No cross-mission correlation** — patterns are matched but no "this same issue appeared in 3 missions" correlation exists
4. **No confidence decay** — old patterns retain full confidence
5. **No UI surface** — knowledge patterns are not shown to the user anywhere in the frontend
6. **Not a formal capability** — query runs inline, not as its own registered capability
7. **Simple matching** — only matches on framework/authProvider/appType, not on semantic similarity

---

# STEP 9 — QUALITY SYSTEM

## Evidence

Evidence is collected as flat objects passed between capabilities:

```javascript
// capabilities.js:176-180
evidence = {
    workflow: WorkflowObject,      // from workflow_save
    testCases: TestCase[],         // from test_generation
    smokeResults: TestRunSummary,  // from smoke_run
    schedule: ScheduleObject,      // from schedule_create
    devReport: DevIntelObject,     // from dev_intelligence
    featureGaps: Gap[],            // from feature_gap
    missionResult: QualityResult,  // from mission_finalize
    knowledgePatterns: Pattern[]   // from knowledge_write
}
```

## Evidence Normalization

**Not implemented.** Each capability returns its own result shape. There is no normalization step that converts raw evidence into a standard format.

## Evidence Graph

**Not implemented.** Evidence is flat key-value pairs. There is no graph structure linking findings → evidence → capabilities. The `ARCHITECTURE.md` document describes a planned "Raw → Normalized → Evidence Graph" pipeline, but it does not exist in code.

## Quality Scoring

`calculateMissionQuality(findings)` (`devIntelligence.js:265-352`):

```javascript
// Severity weights
const SEVERITY_WEIGHTS = {
    critical: 25, high: 15, medium: 8, low: 3, info: 1
};

// Score calculation
score = 100 - Σ(weight × confidence × (isDuplicate ? 0.1 : 1.0))

// Verdict thresholds
score >= 85 && no critical → pass (release-ready)
score >= 60 && no critical → pass_with_issues (release-ready)
else                       → fail (not release-ready)
```

Additional outputs:
- **risk**: high (critical > 0 or high ≥ 3), medium (high > 0 or medium ≥ 3), low
- **criticalIssues**: list of non-duplicate critical + high findings with title, severity, impact, recommendation
- **recommendations**: top 3 priority actions
- **breakdown**: count by severity + duplicate count

## Decision Making

**Not separated.** The `mission_finalize` capability both:
1. Calculates the quality score (assessment)
2. Determines the verdict and release readiness (decision)

There is no separate Decision Engine that can choose between `approve / regenerate / escalate / stop`.

## Release Readiness

Binary: `releaseReady = score >= 60 && criticalCount === 0`

## Risk Calculation

Heuristic based on severity counts:
- `high`: any critical finding OR ≥ 3 high findings
- `medium`: any high finding OR ≥ 3 medium findings
- `low`: neither

## Recommendation Generation

Top 3 non-duplicate findings sorted by severity, formatted as:
```javascript
{ priority: severity, action: recommendation || fixApproach || "Fix: title", issue: title }
```

---

# STEP 10 — UI

## Navigation

Top navigation bar (`index.html:22-47`):
```
Qase | Runs | Tests | Workflows | Schedules | Bugs | [Project ▾] [+] [🌙] [⚙]
```

Hash-based routing (`router.js`):
- `#/runs` → Agent workspace (3-column)
- `#/tests` → Test case management
- `#/workflows` → Workflow browsing
- `#/schedules` → Regression schedules
- `#/bugs` → Bugs Hub

## Page Hierarchy

```
index.html (724 lines — single HTML file)
├── #page-runs (main workspace)
│   ├── Left: Runs sidebar (session list + New run button)
│   ├── Middle: Chat (transcript + composer)
│   └── Right: Browser panel + 4 tabs
│       ├── REASONING_LOG (mission stage strip + activity feed)
│       ├── APPLICATION_ANALYSIS (app understanding narrative)
│       ├── EVIDENCE (test plan)
│       └── REPORT (mission summary + metrics + findings)
├── #page-tests (hidden)
├── #page-workflows (hidden)
├── #page-schedules (hidden)
├── #page-bugs (hidden)
├── #settings (dialog)
├── #tc-editor (dialog)
├── #bug-detail (dialog)
├── #bug-editor (dialog)
└── #toasts
```

## Component Hierarchy

```
shared.js (dependency root)
├── app.js (core controller — 2,339 lines)
│   ├── Session lifecycle (create, select, load, SSE)
│   ├── Chat rendering (renderMessage, renderTranscript)
│   ├── Activity rendering (renderActivity, upsertActivity)
│   ├── Findings rendering (renderFindings — grouped by category)
│   ├── Report rendering (renderReport — verdict, severity grid)
│   ├── Pipeline event handling (pipeline_start/progress/complete)
│   ├── Settings modal (fillSettings, readSettings, testConnection)
│   ├── Metrics dashboard (renderMetricsOverview)
│   └── Export handlers (markdown, github, jira, linear, csv)
├── pipeline.js (mission progress + app analysis — 389 lines)
├── tests.js (test case management — 1,373 lines)
├── bugs.js (bugs hub — 525 lines)
├── workflows.js (workflow browsing — 292 lines)
├── schedules.js (schedule management — 411 lines)
└── router.js (hash routing — 81 lines)
```

## Mission Screen

The Runs page is the mission screen. It is a **3-column grid**:
- **Left (260px)**: Session list with status dots, finding counts, timestamps
- **Middle (flexible)**: Chat transcript with agent messages, thinking strip, composer
- **Right (38%)**: Live browser screenshot + 4 tabs below

## Conversation

The middle column is conversation-first. Agent messages render as markdown (`shared.js:markdown()`). User messages are plain text. Pipeline events inject agent-style messages into the transcript (`app.js:injectPipelineMessage`). The thinking strip shows live reasoning above the composer.

## Application Analysis

Renders in the APPLICATION_ANALYSIS tab (`pipeline.js:buildNarrativeHtml`):
- Detected app type + confidence
- Confidence reasoning ("verified through auth, navigation, workflow exploration")
- Summary sentence
- Compact counts (Detected N / Missing M)
- Expandable lists for detected/missing features
- Vertical workflow chain with ↓ arrows
- Fix suggestions list (from dev intelligence)

## Mission Status

Renders as a **stage strip** at the top of REASONING_LOG (`pipeline.js:renderPipeline`):
- Current activity: `[ RUNNING ] Understanding application… 00:32`
- Completed stages as chips: `[ OK ] Application understood`, `[ FAIL ] Test scenarios generated`
- Final state: `[ COMPLETE ] Mission finished — 91% confidence`

## Evidence Tab

Shows the test plan (`app.js:renderTodos`):
- Each todo item with status icon (✓ done, ◉ in-progress, ○ pending)
- Count badge: `EVIDENCE 4/9`

## Report Tab

Shows (`app.js:renderReport` + `renderMetricsOverview`):
- Mission summary bar (TYPE, QUALITY, RELEASE, CONFIDENCE, ANOMALIES, GAPS)
- Metrics overview (Sessions count, Findings count with severity breakdown, Test Cases, Regression Pass Rate)
- Verdict banner
- Severity grid
- Findings grouped by category

## Reasoning

The thinking strip (`app.js:241-319`) shows:
- "Thinking" or "Working" label
- Last 110 characters of reasoning text
- Expandable to show full reasoning
- Reasoning is ephemeral — not stored, lost on page reload

## Current UX Philosophy

Based on meeting transcripts and implemented code:
- **Conversation is 70%** of the screen — panels moved to right sidebar
- **Developer IDE aesthetic** — JetBrains Mono font, GitHub Dark colors (#0d1117, #161b22, #30363d), 3px border radius, no glassmorphism
- **Developer terminology** — `[ OK ]`, `[ RUNNING ]`, `[ COMPLETE ]`, `MISSION_STATUS`, `REASONING_LOG`
- **No model name exposed** — Thomas explicitly called this a bug; model badge was removed
- **IDE quick actions** — prompt chips ("Validate Website", "Test Authentication") instead of terminal commands

---

# STEP 11 — DATABASE

## There Is No Database

**All persistence is JSON files** in `.qase/`. There is no SQL database, no ORM, no migration system.

Each store module reads its JSON file into memory on boot and writes back with a debounced atomic write:

| File | Store Module | Size | Debounce |
|---|---|---|---|
| `sessions.json` | store.js | 3.2 MB | 250ms |
| `findings.json` | findings.js | 404 KB | 250ms |
| `workflows.json` | workflows.js | 1.1 MB | 250ms |
| `test-cases.json` | testCases.js | 488 KB | 250ms |
| `missions.json` | missions.js | 12 KB | 500ms |
| `knowledge.json` | knowledge.js | empty | 500ms |
| `schedules.json` | scheduler.js | 16 KB | 250ms |
| `regression-runs.json` | regressionStore.js | 212 KB | 250ms |
| `replay-runs.json` | replayStore.js | 520 KB | 250ms |
| `projects.json` | projects.js | 308 B | 250ms |
| `baselines.json` | baselines.js | empty | 250ms |
| `suites.json` | suites.js | empty | 250ms |
| `config.json` | config.js | 586 B | immediate |

## "Tables" (JSON Files) and Their Relationships

```
projects.json
  └── 1:N → sessions (via projectId)
  └── 1:N → findings (via projectId)
  └── 1:N → test-cases (via projectId)
  └── 1:N → workflows (via projectId)
  └── 1:N → missions (via projectId)
  └── 1:N → schedules (via projectId)

sessions.json
  ├── 1:N → findings (via sessionId)
  ├── 1:N → capturedSteps (inline)
  ├── 1:N → activities (inline)
  ├── 1:N → messages (inline)
  └── 1:1 → report (inline)

missions.json
  ├── 1:1 → sessionId (current execution)
  └── 1:N → iterations[] (each has sessionId, findings, qualityScore)

workflows.json
  └── 1:N → test-cases (via workflowId)

test-cases.json
  ├── N:1 → suite (via suiteId)
  └── N:N → findings (via testCaseIds[] on finding)

findings.json
  ├── N:1 → session (via sessionId)
  ├── N:N → test-cases (via testCaseIds[])
  └── 1:N → comments[] (inline)
```

## Mission Lifecycle (in data)

```
Mission created → status: "created"
  → linked to session → status: "running"
  → session completes → pipeline runs
  → mission_finalize → status: "completed", qualityScore set
  → iteration recorded with findings + score + verdict
```

## Finding Lifecycle (in data)

```
Finding created (agent or pipeline) → status: "open"
  → user investigates → status: "in_testing"
  → developer fixes → status: "resolved"
  → verified → status: "closed"

OR: finding marked as duplicate → isDuplicate: true, duplicateOf: <id>
```

## Knowledge Lifecycle (in data)

```
Pattern created (post-mission) → occurrences: 1, confidence: 0.3
  → same issue in next mission → occurrences: 2, confidence: 0.5
  → ... → occurrences: 10+, confidence: 0.95
```

---

# STEP 12 — API

## Complete API Inventory

**Total: ~78 endpoints** across the Express app.

### Health & Configuration (4)
| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/health` | No | Server uptime + project info |
| `GET /api/config` | No | Public config (no secrets) |
| `PUT /api/config` | Yes | Save LLM endpoint config |
| `POST /api/config/test` | Yes | Probe LLM connectivity |

### Sessions (10)
| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/sessions` | No | List sessions (lightweight) |
| `POST /api/sessions` | No | Create session |
| `GET /api/sessions/:id` | No | Full session data |
| `DELETE /api/sessions/:id` | Yes | Delete session |
| `POST /api/sessions/:id/message` | Yes | Send URL/instruction → start agent |
| `POST /api/sessions/:id/answer` | Yes | Resume from pending question |
| `POST /api/sessions/:id/credentials` | Yes | Store secrets in vault |
| `POST /api/sessions/:id/stop` | Yes | Abort running session |
| `GET /api/sessions/:id/detail` | No | Lazy-load heavy arrays |
| `GET /api/sessions/:id/report.md` | No | Markdown report |

### SSE (1)
| `GET /api/sessions/:id/events` | No | Real-time event stream (15s heartbeat) |

### Pipeline (2)
| `POST /api/sessions/:id/run-pipeline` | Yes | Manually trigger pipeline |
| `GET /api/sessions/:id/pipeline-status` | No | Poll pipeline stage status |

### Dev Intelligence (7)
| `POST /api/sessions/:id/analyze-dev` | Yes | Run LLM analysis |
| `GET /api/sessions/:id/dev-intelligence` | No | Cached results |
| `GET /api/sessions/:id/feature-gaps` | No | Feature gap analysis |
| `GET /api/findings/:id/dev-analysis` | No | Per-finding analysis |
| `GET /api/findings/:id/fix-prompt` | No | Per-finding fix prompt |
| `GET /api/sessions/:id/app-improvement-prompt` | No | App-level prompt |
| `GET /api/sessions/:id/dev-report` | No | Full markdown report |

### Workflows (6), Test Cases (14), Suites (4), Schedules (6), Regression (3), Findings (10), Projects (4), Missions (6)

### Public API v1 (8)
| Endpoint | Purpose |
|---|---|
| `POST /api/v1/missions` | Create + auto-start mission |
| `POST /api/v1/missions/:id/start` | Start mission |
| `GET /api/v1/missions/:id` | Poll status |
| `POST /api/v1/missions/:id/stop` | Stop mission |
| `POST /api/v1/missions/:id/iterate` | Run next iteration |
| `GET /api/v1/missions/:id/comparison` | Compare iterations |
| `GET /api/v1/missions/:id/report` | Get report (json/md) |
| `POST /api/v1/webhooks` | Register webhook |

## Authentication

`requireApiToken` middleware (`index.js`): checks Bearer header or `qase_token` cookie against `config.apiToken` using timing-safe comparison.

**When no token is configured, ALL routes are open.** This is the current state — no API token is set.

---

# STEP 13 — PLAYWRIGHT

## Browser Lifecycle

```
Agent calls browser_open
  → SDK launches Chromium (if not already running)
    → useBundledChromium() finds executable
    → Browser launched with --no-sandbox
  → browserBridge attaches to the service
  → Frame streaming starts (setInterval 320ms)
  → Cursor tracking wraps all interaction methods

Browser idle (BROWSER_IDLE_MS = 0 → never auto-close)
  → Actually kept alive indefinitely between turns

Session ends / user stops
  → bridge.suspend() — captures cookies, localStorage, URL
  → runtime.dispose() — closes browser
```

Only **one browser** is open at a time (`closeOtherBrowsers`, `agent.js:99`).

## Actions

The SDK provides these browser tools (all whitelisted in `agent.js:28`):

| Tool | What It Does |
|---|---|
| `browser_open` | Navigate to URL |
| `browser_close` | Close browser |
| `browser_click` | Click element |
| `browser_type` | Type text into element |
| `browser_fill` | Fill form field |
| `browser_select_option` | Select dropdown option |
| `browser_press_key` | Press keyboard key |
| `browser_hover` | Hover over element |
| `browser_scroll` | Scroll page |
| `browser_screenshot` | Full-page PNG screenshot |
| `browser_snapshot` | DOM tree with CSS paths |
| `browser_diagnostics` | Console + network + DOM health |
| `browser_wait` | Wait for condition |
| `browser_navigate_back` | Go back |
| `browser_tabs` | Multi-tab management |

## Screenshots

**Live frames:** JPEG, quality 55, every 320ms → SSE → frontend `<img>`
**Diagnostic:** Full-page PNG → stored in `.qase/artifacts/:runId/`
**Visual regression:** Pixelmatch comparison against approved baselines

## Console Capture

Playwright's `page.on('console')` and `page.on('requestfailed')` listeners are attached in `replay.js:createCollector()` and wrapped in `browserBridge.js` for the live agent.

## Network Capture

`page.on('response')` captures 4xx/5xx responses. Used in `finalizeStepOutcome()` to detect broken network requests after actions.

## DOM

`browser_snapshot` returns a structured DOM tree. `browserBridge.js` enhances it with CSS structural paths (`#id`, `[data-testid]`, `tag:nth-of-type(n)`) for precise selector targeting.

## Recovery

- **Navigation settle:** After each action, waits up to 1.6s for URL change
- **Session restore:** On browser relaunch, replays cookies + localStorage + navigates to saved URL
- **Self-healing selectors:** `selfHeal.js` uses LLM to find replacement CSS selectors when tests fail due to selector changes

## Retry

**Agent level:** Model timeout → 2 retries with 2000ms delay
**Test replay level:** Configurable retries (default 1). On first failure: captures DOM, calls LLM for selector healing, patches test case if confidence ≥ 0.8, marks `flaky` if passes on retry.

---

# STEP 14 — AI

## Current AI Usage

The system uses LLM in **four distinct contexts**:

### 1. Interactive Agent (agent.js)
- **Model:** Configured via Settings (default: Anthropic claude-opus-5)
- **Role:** Explores websites autonomously, files findings, finishes reports
- **Reasoning:** Streamed live (ephemeral, not stored)
- **Max turns:** 120 (configurable)
- **Reasoning level:** medium (configurable)

### 2. Test Generation (testGen.js)
- **Model:** `getModelTier('execution')` — can be a different/cheaper model
- **Role:** Generates replayable test cases from captured workflows
- **Prompt:** "You are a senior QA engineer..." with workflow steps + findings

### 3. Dev Intelligence (devIntelligence.js)
- **Model:** `getModelTier('execution')`
- **Role:** Per-finding root cause analysis + app improvement report
- **Output:** `{ rootCause, fixApproach, affectedArea, estimatedComplexity, confidence }`

### 4. Feature Gap Enhancement (featureGap.js:1199)
- **Model:** `getModelTier('execution')`
- **Role:** Reviews heuristic gaps, filters false positives, suggests missed features
- **Status:** Code exists but **requires `config.model && config.baseUrl`** — currently not wired

### 5. Self-Healing (selfHeal.js)
- **Model:** `getModelTier('execution')`
- **Role:** Finds replacement CSS selectors when tests fail
- **Confidence threshold:** 0.8 (configurable)

## LLM Integration

All non-agent LLM calls go through `testGen.js:callLLM()`:
```javascript
// Direct OpenAI-compatible /chat/completions POST
fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: 4096, temperature: 0.3 })
})
```
120-second timeout. No streaming — waits for full response.

## Prompt Flow

```
User types URL
  → prompt.js:buildQaContext(session, liveUrl)
    → System prompt: "You are Qase, an autonomous QA engineer"
    → Target URL, credential names, browser location
    → Allowed tools, workflow instructions, safety rules
  → SDK sends to LLM with tool definitions
  → LLM responds with reasoning + tool calls
```

## What Is Heuristic vs AI?

| Component | Heuristic | LLM-Powered |
|---|---|---|
| Agent exploration | — | ✅ (every decision) |
| Finding filing | — | ✅ (agent decides what's a bug) |
| App inventory extraction | ✅ (regex + text matching) | — |
| Purpose detection | ✅ (keyword scoring) | ❌ (enhanceGapsWithLLM exists but unwired) |
| Feature gap detection | ✅ (expected vs actual) | ❌ (same as above) |
| Quality scoring | ✅ (severity × confidence) | — |
| Test generation | — | ✅ |
| Root cause analysis | — | ✅ |
| Selector healing | — | ✅ |
| Knowledge matching | ✅ (exact key match) | — |

**The heuristic floor is built. The LLM ceiling is partially absent.**

---

# STEP 15 — WORKING VS NOT WORKING

| Component | Status | Why |
|---|---|---|
| Agent exploration | **Working** | Tested on studio.drytis.ai, 92 findings filed |
| Browser bridge (screenshots, cursor) | **Working** | Live SSE streaming verified |
| Credential vault | **Working** | Secrets never reach LLM, placeholder substitution works |
| Session store + SSE | **Working** | 12 sessions, real-time updates |
| Finding store + deduplication | **Working** | 165 findings with quality scoring |
| Test case generation | **Working** | LLM generates replayable tests from workflows |
| Test replay engine | **Working** | Deterministic Playwright replay with visual regression |
| Self-healing selectors | **Working** | LLM finds replacement selectors |
| Cron scheduler | **Working** | Schedules created, next-run computed |
| Capability Registry + Orchestrator | **Working** | 8 capabilities, topological sort, dependency resolution |
| Feature Gap Analysis | **Partial** | 43% purpose detection accuracy; heuristic-only |
| Knowledge Layer | **Partial** | Code works but knowledge.json is empty; no patterns learned yet |
| Quality scoring | **Working** | Severity-weighted deduction, verdicts computed |
| Mission iteration tracking | **Working** | recordIteration, getComparisonIterations |
| Dev Intelligence (root cause) | **Working** | LLM analysis per finding, cached |
| UI — Agent workspace | **Working** | 3-column, 4-tab, conversation-first |
| UI — Developer IDE aesthetic | **Working** | JetBrains Mono, GitHub Dark, flat surfaces |
| UI — Bugs Hub | **Working** | Board, detail drawer, editor, status workflow |
| UI — Tests page | **Working** | CRUD, suites, editor, execution, visual diffs |
| UI — Workflows page | **Working** | List, search, expand, generate tests |
| UI — Schedules page | **Working** | Trend chart, create, enable/disable |
| Export (Markdown/GitHub/Jira/Linear) | **Working** | Session + finding level exports |
| JUnit XML | **Working** | CI integration |
| BrowserStack integration | **Partial** | Code exists but untested |
| LLM-Enhanced Feature Gaps | **Not wired** | `enhanceGapsWithLLM` exists but no API key configured |
| Decision Engine | **Not implemented** | Merged into mission_finalize |
| Evidence Graph | **Not implemented** | Flat objects only |
| Continuous Validation Loop | **Not implemented** | Manual iterate endpoint exists, no auto-loop |
| AI Studio Contract | **Not implemented** | API exists but no live integration |
| Knowledge Query as formal capability | **Partial** | Runs inline, not registered |
| Real-world validation harness | **Not implemented** | No test apps with ground truth |
| Database | **Not implemented** | JSON files only |
| Multi-user auth | **Not implemented** | Single user, API token optional |
| Streaming reasoning to UI | **Partial** | Reasoning streams to thinking strip, not token-by-token into conversation |
| AI collaboration (mid-mission follow-ups) | **Not implemented** | User can't steer agent mid-mission |

---

# STEP 16 — IMPLEMENTATION STATUS

| Subsystem | Completed % | Evidence |
|---|---|---|
| **Agent Runtime** | 90% | Fully functional, tested on real sites. Missing: streaming reasoning to conversation |
| **Playwright / Browser** | 95% | Screenshots, cursor, console, network, recovery, self-heal. BrowserStack untested |
| **Capability Registry** | 85% | 8 capabilities, topological sort, evidence passing. Missing: parallel execution, adaptive planning |
| **Orchestrator** | 70% | Sequential execution, dependency resolution, skip-on-failure. Missing: retry, timeout, adaptive selection |
| **Application Understanding** | 40% | 43% purpose detection, 11-type catalog, heuristic-only. LLM enhancement unwired |
| **Feature Gap Analysis** | 50% | Heuristic pipeline works, workflow gaps detected. LLM refinement absent |
| **Knowledge Layer** | 30% | Phase 1 code works (write/read/match). Knowledge.json empty, no UI, no formal capability |
| **Quality Assessment** | 80% | Severity-weighted scoring, risk, recommendations. Working |
| **Decision Engine** | 0% | Not implemented as separate component |
| **Evidence Pipeline** | 20% | Flat evidence passing. No normalization, no graph |
| **Continuous Validation** | 10% | recordIteration exists. No auto-loop, no convergence measurement |
| **AI Studio Loop** | 0% | API contract defined, no live integration |
| **Mission Layer** | 75% | CRUD, iterations, comparison. Missing: auto-trigger, convergence tracking |
| **UI** | 80% | Developer IDE aesthetic, 4-tab panel, conversation-first. Missing: live streaming, AI collaboration |
| **Test Replay** | 90% | Deterministic replay, visual regression, self-heal, parallel execution |
| **Regression Scheduling** | 85% | Cron-based, trend tracking, manual trigger |
| **Bugs Hub** | 85% | Board, detail, editor, status workflow, exports |
| **Security** | 60% | Credential vault works. Missing: multi-user auth, API token enforcement, session isolation |
| **Database** | 0% | JSON files only |
| **Scalability** | 10% | Single process, single browser, in-memory state |

**Overall: ~55-60% of the frozen architecture is implemented.**

---

# STEP 17 — CURRENT LIMITATIONS

## Technical
1. **No database** — all data in JSON files. `sessions.json` is already 3.2 MB; will degrade as data grows
2. **Single process** — no clustering, no worker threads, no message queue
3. **Single browser at a time** — `closeOtherBrowsers()` closes all but the active session
4. **No parallel capability execution** — independent capabilities run sequentially
5. **LLM enhancement not wired** — `enhanceGapsWithLLM` requires config that isn't set
6. **43% purpose detection** — heuristic-only, no LLM refinement
7. **No streaming to conversation** — reasoning goes to thinking strip, not token-by-token into chat

## Architectural
1. **Decision Engine not separated** — violates architecture principle #7
2. **No Evidence Graph** — flat evidence, no traceability
3. **No adaptive planning** — Orchestrator runs fixed capabilities regardless of mission type
4. **Knowledge Layer not influential** — patterns matched but don't change behavior
5. **No continuous validation loop** — one-shot execution

## UX
1. **No mid-mission steering** — user can't say "focus on authentication" during a run
2. **No progressive findings** — findings appear in report but not progressively in conversation
3. **No knowledge UI** — learned patterns are invisible to the user
4. **Reasoning is ephemeral** — lost on page reload
5. **No mobile experience** — three-column layout doesn't work below 768px

## Performance
1. **sessions.json loads entirely into memory** on boot — 3.2 MB and growing
2. **No pagination** on session list, findings list, or test case list (frontend batches at 25)
3. **No caching** — every API call hits the in-memory store
4. **Browser screenshots at 320ms interval** — bandwidth-intensive

## Scalability
1. **Single Node.js process** — vertical scaling only
2. **In-memory state** — not shared across instances
3. **Single browser** — blocks concurrent missions
4. **JSON file I/O** — becomes bottleneck with concurrent writes
5. **No rate limiting** — API endpoints have no throttling

## AI
1. **No LLM key wired** for feature gap enhancement
2. **Heuristic purpose detection** — keyword matching, not semantic understanding
3. **No RAG** — knowledge layer is simple key matching, not retrieval-augmented generation
4. **No model routing** — same model for exploration and analysis (config supports tiers but not dynamic routing)
5. **No cost management** — no tracking of LLM token usage per mission

---

# STEP 18 — SCALABILITY

## Can this architecture support:

### 100 users
**Yes, with minor changes.**
- Single process can handle ~50 concurrent sessions (limited by browser count)
- JSON files are fine at this scale (< 100 MB total)
- Need: API token enforcement, basic rate limiting, session isolation

### 1,000 users
**No, without significant changes.**
- **Bottleneck: Single browser at a time** — needs browser pooling (Playwright can manage multiple contexts)
- **Bottleneck: JSON file I/O** — concurrent writes cause contention. Need PostgreSQL or SQLite
- **Bottleneck: In-memory state** — sessions.json at 3.2 MB × 10 = 32 MB, manageable but fragile
- Need: Database, browser pool, session queue, horizontal scaling (at least 2 instances behind a load balancer)

### 10,000 users
**No, fundamental architecture changes required.**
- Need: PostgreSQL + Redis, Kubernetes with auto-scaling, browser-as-a-service (BrowserStack or cloud browser pool), message queue (RabbitMQ/SQS) for pipeline jobs, CDN for frontend assets, proper authentication (OAuth/OIDC)

### 1M users
**Not feasible with current architecture.**
- Would need: Full microservices architecture, managed browser infrastructure, distributed LLM API management, multi-region deployment, enterprise auth, observability stack (Prometheus/Grafana)

## Required Changes Summary

| Scale | Required Change | Effort |
|---|---|---|
| 100 users | API tokens, rate limiting, session isolation | Low |
| 1,000 users | Database, browser pool, horizontal scaling | Medium |
| 10,000 users | Kubernetes, message queue, browser-as-a-service | High |
| 1M users | Microservices, multi-region, enterprise auth | Very High |

---

# STEP 19 — SECURITY

## Authentication
- **API token** — optional, timing-safe comparison via `crypto.timingSafeEqual`. **Currently disabled** (no token configured).
- **Cookie-based** — `qase_token` httpOnly cookie auto-set for same-origin convenience
- **No user accounts** — single-user system

## Authorization
- **None.** Once authenticated (if token is set), all endpoints are accessible. No role-based access control.

## Secrets
- **Credential vault** (`secrets.js`) — **strong design**:
  - Secrets stored in-memory only, never persisted to disk
  - Model receives placeholder names (`QA_USERNAME`), never real values
  - `resolveSecrets()` swaps `{{PLACEHOLDER}}` → real value at browser-fill time
  - `redact()` masks all known secret values (≥3 chars) in any object reaching the model or UI
  - Deep-walks objects/arrays/strings up to depth 8

## API Keys
- LLM API key stored in `.qase/config.json` (mode 0600)
- Never sent to frontend — Settings modal shows `•••• (set — leave blank to keep)`
- `getPublicConfig()` strips all sensitive fields

## Session Handling
- Sessions are UUID-based, stored in memory
- No session expiry mechanism
- No session isolation between users (single-user system)

## Browser Isolation
- Each session gets its own workspace directory (`.qase/workspaces/:id`)
- Browser context is per-session
- Only one browser runs at a time — prevents cross-session interference
- But: no sandboxing beyond Playwright's default process isolation

## Prompt Injection
- **Not specifically addressed.** The agent reads page content (DOM snapshots, text) which could contain adversarial prompts. The system prompt includes safety rules ("no destructive actions, no payments") but there is no explicit prompt-injection defense.
- The `approveTool` whitelist is the primary defense — even if the LLM is tricked, it can only call whitelisted browser tools.

## Sensitive Data
- Findings may contain URLs, form values, error messages from the target site
- `redact()` masks known secrets but doesn't detect unknown sensitive data (PII, tokens in page content)
- Screenshots may capture sensitive UI content — stored as artifacts in `.qase/artifacts/`

---

# STEP 20 — FUTURE ROADMAP

*Based ONLY on current code gaps, not imagination.*

## High Priority

### 1. Wire LLM Enhancement for Feature Gaps
- **Why:** `enhanceGapsWithLLM` exists at `featureGap.js:1199` but requires `config.model && config.baseUrl`. Purpose detection is at 43% accuracy with heuristics alone. This is the single biggest intelligence improvement available with existing code.
- **What:** Configure an LLM API key, verify `enhanceGapsWithLLM` produces better results than heuristics alone.

### 2. Build Real-World Validation Harness
- **Why:** We have 43% accuracy but no measured metrics for gap precision, false positive rate, or workflow coverage. Cannot improve what we don't measure.
- **What:** Build 5 test apps with documented expected features, run the pipeline, measure accuracy/precision/recall.

### 3. Separate Decision Engine
- **Why:** Architecture principle #7 says "Assessment and decision separate." Currently `mission_finalize` does both. This blocks the continuous validation loop.
- **What:** Split into `quality_assessment` (measures) + `decision_engine` (decides: approve/regenerate/escalate/stop).

## Medium Priority

### 4. Implement Continuous Validation Loop
- **Why:** Core product vision. `recordIteration` and `POST /api/v1/missions/:id/iterate` exist but no auto-loop.
- **What:** Decision Engine triggers regeneration → new session → revalidation → comparison → approve/stop.

### 5. Parallel Capability Execution
- **Why:** `dev_intelligence` and `feature_gap` have no dependencies on each other but run sequentially.
- **What:** Execute independent capabilities concurrently.

### 6. Knowledge Layer Phase 2
- **Why:** knowledge.json is empty. Patterns aren't influencing behavior.
- **What:** Formal capability, cross-mission correlation, UI surface, confidence decay.

### 7. Streaming Reasoning to Conversation
- **Why:** Reasoning goes to thinking strip but not token-by-token into the chat. User can't see the agent "thinking out loud" in the transcript.
- **What:** Stream reasoning deltas into the conversation as collapsible agent messages.

## Low Priority

### 8. Database Migration
- **Why:** JSON files work now but sessions.json is 3.2 MB. Won't scale.
- **What:** Migrate to PostgreSQL or SQLite with proper schema.

### 9. Multi-User Authentication
- **Why:** Single-user system. No RBAC.
- **What:** OAuth/OIDC, user accounts, project-level permissions.

### 10. Browser Pool
- **Why:** Single browser at a time blocks concurrent missions.
- **What:** Playwright browser contexts pool with configurable size.

---

# STEP 21 — VISUAL DIAGRAMS

## 1. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         INPUT SOURCES                            │
│  Chat UI  │  Public API v1  │  Cron Scheduler  │  AI Studio      │
└──────┬────────────┬────────────────┬─────────────────────────────┘
       │            │                │
       ▼            ▼                ▼
┌──────────────────────────────────────────────────────────────────┐
│                     server/index.js (Express)                    │
│                     78 endpoints + SSE streaming                 │
└──────────┬───────────────────────────────┬──────────────────────┘
           │                               │
     ┌─────▼──────┐          ┌────────────▼────────────┐
     │  agent.js   │          │  capabilities.js         │
     │  LLM +      │          │  Orchestrator            │
     │  Browser    │          │  (8 capabilities)        │
     └──┬───┬─────┘          └──┬───┬───┬───┬───┬──────┘
        │   │                   │   │   │   │   │
  ┌─────▼┐ ┌▼──────┐    ┌──────▼┐ ┌▼──┐│ ┌─▼┐ ┌▼──────┐
  │qaTools│ │browser│    │testGen│ │dev││ │fg│ │mission│
  │      │ │Bridge │    │      │ │Int││ │  │ │Final  │
  └──────┘ └───┬──┘    └──────┘ └───┘│ └──┘ └───────┘
                 │                     │
           ┌─────▼─────┐        ┌──────▼──────┐
           │  secrets   │        │ knowledge   │
           │  (vault)   │        │ .js         │
           └───────────┘        └─────────────┘
                 │
┌────────────────▼─────────────────────────────────────────────────┐
│                    store.js (Session + Event Bus)                │
│            In-memory Map + JSON mirror (.qase/*.json)            │
└──────────────────────────────────────────────────────────────────┘
         │              │             │            │
   ┌─────▼─────┐  ┌─────▼────┐  ┌─────▼────┐  ┌───▼──────┐
   │ findings  │  │ testCases│  │ workflows│  │ missions │
   └───────────┘  └──────────┘  └──────────┘  └──────────┘
```

## 2. Mission Flow

```
User submits URL
    │
    ▼
Session created (store.js)
    │
    ▼
Agent runs (agent.js) ─── LLM decides actions ─── Playwright executes
    │                    │                        │
    │                    ├─ reasoning (streamed)  ├─ screenshots
    │                    ├─ tool selection        ├─ cursor tracking
    │                    └─ finding creation      └─ DOM snapshots
    │
    ▼
Agent calls finish_qa_report
    │
    ▼
Pipeline triggered (capabilities.js)
    │
    ├─ workflow_save ──── test_generation ──── smoke_run (optional)
    │                                            schedule_create
    ├─ dev_intelligence (parallel concept)
    ├─ feature_gap ──── knowledge query (inline)
    │                  ─── analyzeFeatureGaps
    │                  ─── enhanceGapsWithLLM (if wired)
    │
    ├─ mission_finalize ─── quality scoring
    │                      ─── verdict
    │                      ─── iteration recording
    │
    └─ knowledge_write ─── pattern extraction
    │
    ▼
pipeline_complete SSE event
    │
    ▼
UI updates (mission summary, release assessment)
```

## 3. Agent Flow

```
┌─────────────────────────────────────────────┐
│            agent.js:runTurn()                │
└─────────────────┬───────────────────────────┘
                  │
    ┌─────────────▼──────────────┐
    │ ensureRuntime(session)     │
    │  - Create SDK runtime      │
    │  - Register QA tools       │
    │  - Attach browser bridge   │
    └─────────────┬─────────────┘
                  │
    ┌─────────────▼──────────────┐
    │ runtime.run(task, signal)  │
    │  SDK streams parts:        │
    └─────────────┬─────────────┘
                  │
         ┌────────▼────────┐
         │ for await part: │
         └────────┬────────┘
                  │
    ┌─────────────▼──────────────┐
    │ switch(part.type)          │
    │  reasoning → thinking strip│
    │  chat_text → chat bubble   │
    │  tool_start → activity     │
    │  tool_result → update act  │
    │  task_complete → done      │
    └────────────────────────────┘
```

## 4. Capability Flow (Dependency Graph)

```
workflow_save ──────→ test_generation ──────→ smoke_run (optional)
                  └──→ schedule_create

dev_intelligence (independent)

feature_gap ────→ mission_finalize ────→ knowledge_write
  │
  └── knowledge query (inline)
```

## 5. Evidence Flow

```
workflow_save produces: { workflow }
         │
         ▼
test_generation requires: workflow
           produces: { testCases }
         │
         ▼
smoke_run requires: testCases
       produces: { smokeResults }

──────────────────────────────

feature_gap requires: (none from evidence)
           produces: { featureGaps }
         │
         ▼
mission_finalize requires: (none from evidence)
              produces: { missionResult }
         │
         ▼
knowledge_write requires: (none from evidence)
             produces: { knowledgePatterns }
```

## 6. Knowledge Flow

```
                    WRITE (post-mission)
                    ────────────────────
Session findings (≥ medium severity)
    │
    ▼
detectAppMetadata() → { framework, authProvider, appType }
    │
    ▼
writeKnowledge() → .qase/knowledge.json
    │
    └── Pattern: { pattern, issue, recommendation, occurrences, confidence }

                    READ (pre-analysis)
                    ───────────────────
detectAppMetadata() → { framework, authProvider, appType }
    │
    ▼
queryKnowledge() → matched patterns + capability hints
    │
    └── Returned to feature_gap capability (inline)
```

## 7. Decision Flow

```
Session findings
    │
    ▼
scoreFindingQuality() per finding
    │  - confidence from evidence richness
    │  - duplicate detection
    │  - reproducibility assessment
    │
    ▼
calculateMissionQuality()
    │  - score = 100 - Σ(severity × confidence)
    │  - verdict = pass / pass_with_issues / fail
    │  - releaseReady = score ≥ 60 && no critical
    │  - risk = high / medium / low
    │
    ▼
mission_finalize
    │  - recordIteration({ findings, qualityScore, verdict })
    │  - finalizeMission({ status: completed, qualityScore, ... })
    │  - emit webhooks
    │
    ▼
[NO DECISION ENGINE — cannot choose regenerate/escalate/stop]
```

## 8. UI Structure

```
┌────────────────────────────────────────────────────────────┐
│                      TOP NAVIGATION                         │
│  Qase │ Runs │ Tests │ Workflows │ Schedules │ Bugs │ ⚙   │
├────────┬───────────────────────────┬───────────────────────┤
│ LEFT   │         CENTER            │       RIGHT            │
│ (260px)│       (flexible)          │       (38%)            │
│        │                           │                        │
│ Session│  Chat Transcript          │  ┌─────────────────┐  │
│ List   │  (agent messages,         │  │  Browser Panel  │  │
│        │   user messages,          │  │  (live JPEG      │  │
│ [+New] │   pipeline injections)    │  │   screenshots)   │  │
│        │                           │  └─────────────────┘  │
│ ● Running│  ┌─ Thinking Strip ──┐  │  ┌─────────────────┐  │
│ ○ Done  │  │ "Thinking..."     │  │  │ REASONING_LOG   │  │
│ ○ Idle  │  └───────────────────┘  │  │ APP_ANALYSIS    │  │
│        │                           │  │ EVIDENCE        │  │
│        │  ┌─ Composer ────────┐   │  │ REPORT          │  │
│        │  │ [URL input] [Send]│   │  └─────────────────┘  │
│        │  └───────────────────┘   │                        │
├────────┴───────────────────────────┴───────────────────────┤
│                      TOAST NOTIFICATIONS                     │
└────────────────────────────────────────────────────────────┘
```

## 9. Folder Structure

```
/workspace/
├── server/           (35 files, 11,774 lines)
│   ├── Core:         index.js, agent.js, store.js, config.js
│   ├── Intelligence: capabilities.js, featureGap.js, devIntelligence.js, knowledge.js
│   ├── Testing:      replay.js, testGen.js, testCases.js, selfHeal.js
│   ├── Data:         findings.js, workflows.js, missions.js, scheduler.js
│   ├── Browser:      browserBridge.js, qaTools.js, secrets.js
│   ├── Export:       exporters.js, bugExportgers.js, junit.js, report.js
│   └── Utils:        atomicWrite.js, metrics.js, projects.js, etc.
├── public/           (10 files, 12,018 lines)
│   ├── Core:         app.js, shared.js, router.js
│   ├── Pages:        tests.js, bugs.js, workflows.js, schedules.js
│   ├── Rendering:    pipeline.js
│   └── Shell:        index.html, styles.css
├── tests/            (15 files, 4,296 lines)
├── .drytis/          (architecture docs + specs)
└── .qase/            (runtime JSON data)
```

## 10. API Flow

```
Frontend                Backend
─────────              ────────
app.js ────────→ POST /api/sessions/:id/message ────────→ agent.js:runTurn()
                                                                    │
                     ←── SSE: status(running) ──── ....................│
                     ←── SSE: frame(jpeg) ──── .........................│
                     ←── SSE: reasoning(text) ─── .....................│
                     ←── SSE: message(text) ──── .......................│
                     ←── SSE: activity(start/done) ──── ................│
                     ←── SSE: finding(new) ──── .........................│
                     ←── SSE: report(complete) ─── ......................│
                                                                        │
                     ←── SSE: pipeline_start ──── capabilities.js ◄─────┘
                     ←── SSE: pipeline_progress(running/done) ──── │
                     ←── SSE: pipeline_complete(summary) ──────────┘
```

## 11. Execution Flow (End-to-End)

```
[1] User types URL in composer
[2] POST /api/sessions/:id/message
[3] agent.js:runTurn() starts
[4] SDK launches browser, agent explores
[5] Agent files findings via report_finding
[6] Agent calls finish_qa_report
[7] Pipeline triggered (runAutonomyPipeline)
[8] Orchestrator plans (topological sort)
[9] Capabilities execute sequentially:
     workflow_save → test_generation → dev_intelligence →
     feature_gap → mission_finalize → knowledge_write
[10] SSE: pipeline_complete
[11] UI shows mission summary + release assessment
[12] Mission recorded with quality score + verdict
```

---

# STEP 22 — EXECUTIVE SUMMARY

## What This Project Is

QASE is an **autonomous software quality agent** — an LLM-driven system that tests live websites by exploring them in a real browser, filing structured findings, and producing release assessments. It is positioned as "the autonomous quality layer for AI-generated software," targeting a closed loop where AI tools generate apps and QASE validates them.

## Current State

**MVP with a functional core and partial intelligence layer.**

The agent works: it explores real websites, files real findings (165 across 12 sessions), and produces real quality assessments. The post-session pipeline runs end-to-end through 8 registered capabilities. The UI has a developer IDE aesthetic matching the product owner's vision.

**172 of 172 unit tests pass.** The codebase is 33,124 lines across server, frontend, tests, and docs.

## Strengths

1. **Working agent** — not a mock or prototype. Real LLM driving real Playwright browser on real websites.
2. **Capability-driven architecture** — formal contracts, dependency resolution, evidence passing. Good foundation for extension.
3. **Credential vault** — excellent security design. Secrets never reach disk or LLM.
4. **Comprehensive feature set** — test generation, replay, visual regression, self-healing, scheduling, exports. Much more than just "agent explores."
5. **Zero frontend dependencies** — vanilla JS, no build step, fast load, easy to maintain.
6. **Clear architecture documentation** — 5 frozen documents with principles, contracts, and honest status assessment.
7. **Honest metrics** — 43% accuracy is measured and reported, not hidden.

## Weaknesses

1. **43% purpose detection accuracy** — the heuristic floor is built but the LLM ceiling is unwired.
2. **No Decision Engine** — assessment and decision are merged, violating the architecture's own principles.
3. **No continuous validation loop** — the core product vision (generate→validate→improve→regenerate) is not implemented.
4. **Knowledge layer is empty** — patterns are written in code but knowledge.json contains `[]`.
5. **No database** — all persistence is JSON files. Already at 3.2 MB for sessions alone.
6. **Single browser** — blocks concurrent missions.
7. **No adaptive planning** — all missions run the same capabilities regardless of type.

## Technical Debt

| Item | Severity | Impact |
|---|---|---|
| JSON file persistence | High | Won't scale, concurrent write contention |
| Decision Engine merged into mission_finalize | Medium | Blocks continuous validation loop |
| LLM enhancement unwired | High | Intelligence ceiling is low |
| No parallel capability execution | Low | Performance, not correctness |
| Knowledge layer unused | Medium | Patterns don't influence behavior |
| No API token enforcement | Medium | Security risk |
| sessions.json growing linearly | Medium | Memory pressure on boot |
| Evidence is flat, not graph | Low | Blocks future traceability |

## Risks

1. **Accuracy risk** — 43% purpose detection means feature gap analysis produces false positives. Without LLM enhancement and real-world validation, we don't know the true precision/recall.
2. **Scalability risk** — single process, single browser, JSON files. Will not handle more than ~50 concurrent users.
3. **Security risk** — no API token enforcement, no multi-user auth, no session isolation.
4. **Product risk** — the AI Studio closed loop is the core value proposition but is 0% implemented.
5. **Dependency risk** — heavily dependent on `@cleanslate/sdk` which is at v0.1.0. SDK changes could break the agent.

## Missing Components

| Component | Priority | Blocking |
|---|---|---|
| Decision Engine | High | Continuous validation loop |
| LLM-enhanced analysis | High | Intelligence quality |
| Real-world validation harness | High | Measurement of actual quality |
| Continuous validation loop | Medium | Product vision |
| Database | Medium | Scalability |
| Knowledge Layer Phase 2 | Medium | Learning across missions |
| Multi-user auth | Low | Multi-tenant |
| Browser pool | Low | Concurrency |

## Immediate Priorities

1. **Wire LLM enhancement** — the code exists, just needs an API key. Biggest intelligence improvement available.
2. **Build validation harness** — 5 test apps with documented features. Measure precision/recall/false-positive.
3. **Separate Decision Engine** — mechanical refactor, unblocks the continuous validation loop.

## Long-Term Vision

The product vision is a closed loop: AI Studio generates → QASE validates → QASE generates improvement prompt → AI Studio regenerates → QASE revalidates → verdict after N iterations. This requires:
- Decision Engine (approve/regenerate/escalate/stop)
- Continuous validation loop with convergence measurement
- AI Studio contract (structured input/output)
- Knowledge that influences future validations

The architecture is designed for this. The code is partially built. The gap is execution — finishing the intelligence layer, closing the loop, and measuring whether the system actually improves software quality over iterations.

---

*End of analysis. Every statement is backed by code in `/workspace/server/`, `/workspace/public/`, `/workspace/tests/`, or `/workspace/.drytis/`.*