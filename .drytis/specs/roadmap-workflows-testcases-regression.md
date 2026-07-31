# Qase Roadmap — Workflows, Test Cases & Regression Runs

## Vision (from transcript)

Transform Qase from a one-shot exploration tool into a persistent QA platform:

1. **Agent explores & finds bugs** ✅ (already works — today's baseline)
2. **Extract & persist user workflows** — capture navigated paths as reusable data
3. **Auto-generate test cases from workflows** — turn raw paths into structured assertions
4. **Scheduled regression runs** — re-run saved test cases automatically on a schedule
5. **Reduce manual QA over time** — growing test suite covers more surface area each cycle

---

## Architecture: What Already Exists

```
/workspace
├── server/
│   ├── index.js         Express API routes + SSE stream
│   ├── agent.js         Agent runtime: ensureRuntime(), runTurn(), tool gate
│   ├── store.js         In-memory sessions (Map) + JSON mirror (.qase/sessions.json)
│   ├── config.js        Provider/model resolution (.env ↔ .qase/config.json)
│   ├── prompt.js        System prompt: buildQaContext(session, liveUrl)
│   ├── qaTools.js       report_finding + finish_qa_report tools
│   ├── browserBridge.js Cursor, frames, session restore, secret injection
│   ├── secrets.js       Credential vault (placeholder substitution + redaction)
│   ├── report.js        Markdown report renderer
│   └── demoSite.js      Deliberately broken practice site (/demo)
├── public/
│   ├── index.html       3-panel dashboard (runs | chat | browser+tabs)
│   ├── app.js           SSE consumer, rendering, settings
│   └── styles.css       Apple-glass dark theme
└── scripts/package.mjs  Shareable zip builder
```

**Key data structures (today):**
- `Session`: `{ id, title, status, targetUrl, messages[], activities[], findings[], todos[], report, pendingQuestion, contextUsage, secretNames[] }`
- `Finding`: `{ id, ts, title, severity, category, url, steps[], expected, actual, evidence }`
- `Todo`: `{ text, status: pending|in_progress|completed }`
- `Report`: `{ ts, verdict, summary, covered[], notCovered[], recommendations[], findings, bySeverity }`

**Key patterns:**
- All state changes funnel through `emit(session, type, payload)` in store.js — mutates session + broadcasts via SSE + persists to disk.
- Sessions persist to `.qase/sessions.json`; runtime handles (browser, SDK) live in a separate in-memory `Map` and are never serialized.
- Agent gets its instructions from `buildQaContext()` which is refreshed every turn via `additionalContext()`.
- Two custom tools are injected into the SDK runtime per-session in `ensureRuntime()`.

---

## Phase 1 — Workflow Capture & Persistence

**Goal:** When the agent tests a site, the browser actions it takes get captured as structured "workflow steps" that persist alongside the session. Users can review, name, and save individual workflows.

### Files to change

#### New: `server/workflows.js`
Workflow engine — capture, store, retrieve.

```js
// Workflow shape:
{
  id:          string (UUID),
  sessionId:   string,       // origin session
  name:        string,       // user-editable, e.g. "User login flow"
  targetUrl:   string,       // the site under test
  steps:       WorkflowStep[],
  createdAt:   number,
  updatedAt:   number,
  tags:        string[]      // e.g. ['auth', 'forms']
}

// WorkflowStep shape:
{
  action:      string,       // 'navigate' | 'click' | 'fill' | 'select' | 'check' | 'key' | 'scroll' | 'screenshot' | 'diagnostics'
  target:      string,       // CSS selector or descriptive label
  label:       string,       // human-readable description
  value:       string|undefined,  // for fill/select (redacted if credential)
  url:         string|undefined,  // page URL at time of step
  ts:          number
}
```

**Functions:**
- `captureStep(sessionId, activity)` — called from the agent's `onToolStart` wrapper (agent.js). Converts a browser_* tool call into a WorkflowStep and appends to the session's `capturedSteps[]`.
- `getCapturedSteps(sessionId)` — returns raw steps from a session.
- `saveWorkflow(sessionId, { name, stepIndices, tags })` — promotes selected captured steps into a named, persistent Workflow object. Writes to `.qase/workflows.json`.
- `listWorkflows(targetUrl?)` — returns saved workflows, optionally filtered by site.
- `getWorkflow(id)` — single workflow with steps.
- `deleteWorkflow(id)`.
- `updateWorkflow(id, patch)` — rename, re-tag, reorder steps.

**Persistence:** `.qase/workflows.json` (same pattern as `sessions.json`).

#### Modified: `server/store.js`
- Add `capturedSteps: []` to the session shape in `createSession()`.
- Add `capturedSteps` to the serialization/deserialization (it persists with the session).

#### Modified: `server/agent.js`
- In `beginActivity()` (the `onToolStart` wrapper), call `captureStep(session.id, { toolName, input, activity })` for browser_* tools only. This hooks into the existing tool-start event already wired there.

#### Modified: `server/index.js`
New routes:
| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/sessions/:id/workflow` | Get captured (unsaved) workflow steps from a session |
| `POST` | `/api/sessions/:id/workflow` | Save selected steps as a named workflow |
| `GET` | `/api/workflows` | List all saved workflows (optional `?targetUrl=` filter) |
| `GET` | `/api/workflows/:id` | Get one workflow |
| `PUT` | `/api/workflows/:id` | Rename / re-tag / reorder steps |
| `DELETE` | `/api/workflows/:id` | Delete a workflow |

#### Modified: `public/index.html` + `public/app.js`
- Add a "Workflows" tab in the right panel (alongside Activity / Plan / Findings / Report).
- In the Workflows tab: show captured steps from the current session as a timeline. Each step has a checkbox. A "Save as Workflow" button lets the user name the selection and save.
- Add a sidebar section or secondary view showing saved workflows for the current `targetUrl`.

### Acceptance Criteria
- [ ] Browser actions (click, fill, navigate, etc.) during a run are captured as structured steps
- [ ] Steps are visible in the dashboard's new Workflows tab during and after a run
- [ ] User can select steps and save them as a named workflow
- [ ] Saved workflows persist across container restarts
- [ ] Workflows can be filtered by target URL
- [ ] Credential values in captured steps are redacted (masked, not the placeholder text)

---

## Phase 2 — Test Case Generation from Workflows

**Goal:** Convert a saved workflow into a structured test case with assertions. The agent analyzes the workflow steps + session findings to produce test cases that can be replayed independently.

### Files to change

#### New: `server/testCases.js`
Test case engine — generate, store, retrieve, validate.

```js
// TestCase shape:
{
  id:          string (UUID),
  workflowId:  string,       // origin workflow
  name:        string,
  targetUrl:   string,
  preconditions:  string[],   // e.g. "User must be logged out"
  steps:       TestStep[],
  assertions:  Assertion[],
  severity:    string,        // if this test fails, what severity?
  createdAt:   number,
  updatedAt:   number,
  lastRun:     { ts, result, failures[] } | undefined
}

// TestStep shape (lighter than WorkflowStep — the replay script):
{
  action:      string,        // same vocabulary as WorkflowStep
  target:      string,        // selector
  value:       string|undefined,
  description: string
}

// Assertion shape:
{
  type:        string,        // 'url_is' | 'url_contains' | 'element_visible' | 'element_text' | 'no_console_errors' | 'no_failed_requests' | 'custom'
  target:      string|undefined,
  expected:    string,
  description: string
}
```

**Functions:**
- `generateTestCases(workflowId, options)` — delegates to the LLM agent (see below).
- `listTestCases(targetUrl?, workflowId?)`.
- `getTestCase(id)`.
- `updateTestCase(id, patch)`.
- `deleteTestCase(id)`.
- `validateTestCase(testCase)` — static schema check.

**Persistence:** `.qase/test-cases.json`.

#### Modified: `server/agent.js`
- New function: `generateTestCasesForWorkflow(session, workflow)` — creates a temporary agent session, feeds the workflow steps + original findings + page snapshots as context, and asks the LLM to produce structured test cases with assertions. Uses the existing `ensureRuntime()` infrastructure but with a different task prompt.
- The test case generation is itself a constrained agent run: the model doesn't browse, it analyzes the provided workflow data and generates JSON test cases.

#### New: `server/testPrompt.js`
- `buildTestCaseGenPrompt(workflow, findings)` — system prompt for test case generation. Instructs the model to: analyze each step, identify what should be verified after each step, produce assertions, group into test cases by logical flow.

#### Modified: `server/index.js`
New routes:
| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/workflows/:id/generate-tests` | Trigger test case generation for a workflow |
| `GET` | `/api/test-cases` | List all test cases (optional `?targetUrl=`, `?workflowId=`) |
| `GET` | `/api/test-cases/:id` | Get one test case |
| `PUT` | `/api/test-cases/:id` | Edit a test case (rename, edit steps/assertions) |
| `DELETE` | `/api/test-cases/:id` | Delete a test case |

#### Modified: `public/index.html` + `public/app.js`
- In the Workflows tab: add a "Generate Test Cases" button on each saved workflow.
- New "Test Cases" section/tab: list test cases with steps and assertions in an editable view.
- Each test case shows: name, steps, assertions, last run result.
- Allow inline editing of steps and assertions.

### Acceptance Criteria
- [ ] Clicking "Generate Test Cases" on a workflow triggers LLM-based generation
- [ ] Generated test cases contain structured steps + at least one assertion per critical step
- [ ] Test cases are editable (rename, modify steps, add/remove assertions)
- [ ] Test cases persist across restarts
- [ ] The generation prompt incorporates the original session's findings as context

---

## Phase 3 — Test Case Replay Engine

**Goal:** Re-run saved test cases against the target site without the full agent loop. A lightweight Playwright runner executes steps and validates assertions — fast, deterministic, no LLM cost.

### Files to change

#### New: `server/replay.js`
Deterministic test case player.

```js
// ReplayResult shape:
{
  testCaseId:  string,
  ts:          number,
  result:      'pass' | 'fail' | 'error',
  duration:    number,         // ms
  stepResults: StepResult[],
  assertionResults: AssertionResult[],
  screenshots: string[],       // base64 JPEGs from failures
  error:       string|undefined
}

// StepResult: { stepIndex, action, status: 'pass'|'fail'|'skip', error?, durationMs }
// AssertionResult: { index, type, passed: boolean, actual: string, expected: string }
```

**Functions:**
- `runTestCase(testCase, { targetUrl, credentials, headless })` — launches Playwright Chromium, executes steps sequentially, checks assertions, captures screenshots on failure. Returns a ReplayResult.
- `runTestSuite(testCaseIds[], options)` — runs multiple test cases sequentially, collects results, returns summary `{ total, passed, failed, errored, durationMs, results[] }`.

**Implementation:**
- Uses Playwright directly (not the SDK) for deterministic, fast execution.
- Reuses the credential vault pattern: placeholders (`{{QA_PASSWORD}}`) resolved at fill time.
- `browser_diagnostics` assertion: check console errors and failed network requests after step execution.
- Timeout per step: configurable, default 10s.
- Screenshot capture only on failure (keep memory/disk low).

#### Modified: `server/secrets.js`
- Export `resolveSecrets` for the replay engine to use (already exported — just import).

#### Modified: `server/index.js`
New routes:
| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/test-cases/:id/run` | Run a single test case (returns result) |
| `POST` | `/api/test-cases/run` | Run a batch of test cases (body: `{ testCaseIds: [], targetUrl, credentials }`) |
| `GET` | `/api/test-cases/:id/runs` | History of past runs for a test case |

#### Modified: `public/index.html` + `public/app.js`
- Add "Run" button on each test case.
- Add "Run All" button in the test cases view.
- Results displayed inline: step-by-step pass/fail, assertion checks, screenshots for failures.
- Run history per test case (expandable).

### Acceptance Criteria
- [ ] Running a test case executes each step in a real browser via Playwright
- [ ] Assertions are validated automatically (URL match, element visibility, text content, console health)
- [ ] Failures capture a screenshot for evidence
- [ ] Credential placeholders work in replay (same vault resolution)
- [ ] Batch runs return aggregate pass/fail counts
- [ ] Run history persists per test case

---

## Phase 4 — Scheduled Regression Runs

**Goal:** Automatically re-run test suites on a schedule (e.g., 2×/week). Dashboard shows regression trends over time. Notifications on failure.

### Files to change

#### New: `server/scheduler.js`
Cron-style scheduler for regression suites.

```js
// Schedule shape:
{
  id:          string (UUID),
  name:        string,         // "Weekly regression — production"
  targetUrl:   string,
  testCaseIds: string[],
  cronExpr:    string,         // e.g. "0 9 * * 1,4" (Mon+Thu 9am)
  credentials: object|undefined, // stored vault entries for the target
  enabled:     boolean,
  lastRun:     { ts, result, summary } | undefined,
  nextRun:     number,         // computed from cron
  createdAt:   number
}
```

**Functions:**
- `createSchedule(config)`, `updateSchedule(id, patch)`, `deleteSchedule(id)`, `listSchedules()`.
- `tick()` — called on a setInterval (every 60s). Checks each enabled schedule; if `nextRun <= now`, triggers the run.
- `executeSchedule(schedule)` — sets credentials in a temp vault, calls `runTestSuite()` from replay.js, stores results, emits SSE events for live monitoring.
- Cron parsing: use a lightweight cron parser (add `cron-parser` or `cronstrue` to dependencies) — or a simple custom matcher for common patterns (daily, weekly, every-N-days).

**Persistence:** `.qase/schedules.json`.

#### Modified: `server/index.js`
- Start the scheduler tick loop on server boot (after store load).
- New routes:
| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/schedules` | List all schedules |
| `POST` | `/api/schedules` | Create a schedule |
| `PUT` | `/api/schedules/:id` | Update (enable/disable, change cron, edit test cases) |
| `DELETE` | `/api/schedules/:id` | Delete a schedule |
| `POST` | `/api/schedules/:id/run` | Manually trigger a scheduled run now |
| `GET` | `/api/schedules/:id/runs` | Run history for a schedule |

#### New: `server/regressionStore.js`
Stores regression run results over time (separate from sessions — these are lightweight).

```js
// RegressionRun shape:
{
  id:           string (UUID),
  scheduleId:   string|undefined,
  ts:           number,
  targetUrl:    string,
  totalTests:   number,
  passed:       number,
  failed:       number,
  errored:      number,
  durationMs:   number,
  results:      ReplayResult[],   // from replay.js
  trigger:      'scheduled' | 'manual'
}
```

**Persistence:** `.qase/regression-runs.json`.

#### Modified: `public/index.html` + `public/app.js`
- New "Regression" section in the sidebar or a top-level view.
- Schedule management: create/edit/delete schedules with cron picker.
- Regression dashboard: pass/fail trend over time (simple bar/line chart in vanilla JS/SVG), last run summary, flaky test detection.
- Scheduled runs appear as sessions in the runs list (tagged "regression").

### Acceptance Criteria
- [ ] User can create a schedule with a cron expression, target URL, and selected test cases
- [ ] Scheduler ticks every 60s and triggers runs when due
- [ ] Scheduled run results appear in the regression dashboard with trends
- [ ] Schedules can be enabled/disabled
- [ ] Manual "Run Now" works for any schedule
- [ ] Regression run history persists across restarts
- [ ] Failure in a scheduled run is visible in the dashboard

---

## Phase 5 — Smart Model Routing (Cost Optimization)

**Goal:** Use a high-tier model (e.g. Claude Opus) for initial exploration and discovery, then switch to a cheaper/faster model (e.g. drytis/kimi-k2.5) for repetitive test execution. Reduces cost from ~$1/run to ~$0.10-0.20/run for regression.

### Files to change

#### Modified: `server/config.js`
- Add `getModelTier(tier)` — returns `{ provider, model, baseUrl, apiKey }` for a named tier ('discovery' | 'execution').
- Add tier definitions: `MODEL_TIERS = { discovery: {...}, execution: {...} }`, configurable via env (`QASE_DISCOVERY_MODEL`, `QASE_EXECUTION_MODEL`).

#### Modified: `server/agent.js`
- In `ensureRuntime()`, accept a `modelTier` parameter. Use `getModelTier()` to resolve provider config based on whether this is an exploration run or a guided/test-case run.

#### Modified: `server/prompt.js`
- `buildQaContext()` can take an `options` object to vary the prompt depth. For execution-mode runs (test case replay), the prompt can be shorter since the agent is following a script, not exploring.

### Acceptance Criteria
- [ ] Exploration runs use the configured discovery model
- [ ] Test case generation uses the discovery model
- [ ] Regression/replay runs use the execution model (no LLM — deterministic Playwright)
- [ ] Model tier is visible in the settings UI

---

## Phase 6 — Enhanced Reporting & Notifications

**Goal:** Richer reports, trend analysis, and notification hooks for when bugs are found.

### Features

#### 6a. Historical Trend Dashboard
- Track metrics over time: defects found per run, severity trends, test coverage growth, flaky test identification.
- Simple SVG charts (no external chart library — keep the vanilla JS approach).

#### 6b. Notification Webhooks
- Add `QASE_WEBHOOK_URL` env var. On `finish_qa_report` or test case failure, POST a payload to the webhook (Slack, Discord, Teams, or custom).
- Payload: `{ event, session, findings, testCaseResults }`.

#### 6c. Export Formats
- Export findings as JIRA/Linear/GitHub issue JSON (in addition to existing Markdown).
- Export test cases as JSON/CSV for import into other tools.

### Acceptance Criteria
- [ ] Trend dashboard shows defect count and severity over multiple runs
- [ ] Webhook fires on report completion and on test failure
- [ ] Findings can be exported in multiple formats

---

## Phase 7 — Multi-Target Projects

**Goal:** Organize workflows, test cases, and schedules by project/target site. Support testing multiple sites under one Qase instance.

### Features
- **Project** entity: `{ id, name, baseUrl, credentials, testCases[], workflows[], schedules[] }`.
- Sessions, workflows, test cases, and schedules all reference a project.
- Dashboard sidebar shows projects as top-level groupings.
- Credentials stored per-project (not per-session).

### Acceptance Criteria
- [ ] User can create a project with a name and base URL
- [ ] Sessions, workflows, test cases, and schedules are scoped to a project
- [ ] Dashboard groups runs by project
- [ ] Credentials can be shared across sessions within a project

---

## Implementation Priority & Dependencies

```
Phase 1 (Workflow Capture)
    ↓
Phase 2 (Test Case Generation)
    ↓
Phase 3 (Replay Engine)  ←── independent of Phase 5
    ↓
Phase 4 (Scheduled Regression)
    ↓
Phase 6 (Enhanced Reporting)

Phase 5 (Smart Model Routing) ← can be done in parallel with Phase 3-4
Phase 7 (Multi-Target Projects) ← best done after Phases 1-4 are stable
```

## Testing Strategy

- **Unit tests** (Jest or Node built-in test runner):
  - `workflows.js`: step capture, serialization, filtering
  - `testCases.js`: CRUD, schema validation
  - `replay.js`: assertion evaluation (mocked Playwright)
  - `scheduler.js`: cron next-run calculation
- **Integration tests**:
  - End-to-end: create session → run → capture steps → save workflow → generate tests → run tests → verify results
  - Persistence: create entities, restart (re-read from disk), verify integrity
- **Browser tests** (tester sub-agent):
  - Dashboard workflow tab renders captured steps
  - "Save as Workflow" creates a persistent workflow
  - "Generate Test Cases" produces editable test cases
  - "Run" executes a test case and shows pass/fail
  - Schedule creation and regression dashboard

## Technology Decisions

| Concern | Decision | Rationale |
|---------|----------|-----------|
| Cron parsing | `cron-parser` npm package | Lightweight, no native deps, handles edge cases |
| Charts | Vanilla JS + SVG | No external dependency, consistent with existing codebase style |
| Test runner | Node built-in `node:test` | No new dependency; ESM-compatible |
| Persistence | JSON files (same as existing) | Consistent with `.qase/sessions.json` pattern |
| Replay browser | Playwright directly (not SDK) | Deterministic, fast, no LLM cost |
| Model routing | Env-configured tiers | No schema change, backward compatible |
