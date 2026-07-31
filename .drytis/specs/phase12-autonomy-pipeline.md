# Phase 12 — Full Autonomy Pipeline

## Problem
The QA agent finishes testing and files a report — then **everything stops**. 8 manual human steps stand between "agent done" and "nightly regression running." The data for every downstream stage already exists at the moment `finish_qa_report` fires (capturedSteps, findings, targetUrl, projectId), but nothing connects them.

## Current Manual Flow (8 mandatory steps)
```
Agent finishes QA (finish_qa_report)
  → [HUMAN] Switch to Workflows tab
  → [HUMAN] Type workflow name
  → [HUMAN] Click "Save as workflow"
  → [HUMAN] Click "Gen Tests"
  → [HUMAN] Switch to Regression tab
  → [HUMAN] Type schedule name + pick cron
  → [HUMAN] Click "Create" schedule
  → Scheduler auto-runs (already automated ✓)
```

## Target: Zero-Touch Pipeline
```
Agent finishes QA (finish_qa_report)
  → Auto-save workflow from captured steps
  → Auto-generate test cases via LLM (findings-aware)
  → Auto-validate tests (quick smoke run)
  → Auto-create regression schedule (daily 9am default)
  → Pipeline progress shown live in UI
  → All configurable / overridable by user
```

---

## Architecture

### New File: `server/pipeline.js`
Central orchestrator that chains the 4 stages. Each stage emits SSE events for live progress tracking.

```javascript
// Pipeline stages
const STAGES = {
  WORKFLOW_SAVE: 'workflow_save',
  TEST_GENERATION: 'test_generation',
  SMOKE_RUN: 'smoke_run',
  SCHEDULE_CREATE: 'schedule_create'
};

// Entry point — called after finish_qa_report
async function runAutonomyPipeline(session, options)

// Each stage is independently skippable via config:
// config.autoSaveWorkflow, config.autoGenerateTests, config.autoCreateSchedule
```

### Pipeline Event Model (new SSE types)
```
pipeline_start    → { sessionId, stages: [...] }
pipeline_progress → { sessionId, stage, status: 'running|done|skipped|failed', detail, result }
pipeline_complete → { sessionId, summary: { workflowId, testCaseCount, scheduleId } }
```

### Files to Create
1. **`server/pipeline.js`** — Stage orchestrator with SSE progress

### Files to Modify
1. **`server/qaTools.js`** — `finish_qa_report` calls `runAutonomyPipeline()` after setting report
2. **`server/config.js`** — Add autonomy config flags + defaults
3. **`server/index.js`** — SSE forwarding for pipeline events; `POST /api/sessions/:id/run-pipeline` (manual trigger)
4. **`public/app.js`** — Pipeline progress panel (live status chips); settings toggle
5. **`public/index.html`** — Pipeline progress container in session detail
6. **`public/styles.css`** — Pipeline progress styles

---

## Sub-Phases

### 12A — Pipeline Orchestrator + Config
**Backend: the engine that chains all 4 stages after report completion**

- Create `server/pipeline.js`:
  - `runAutonomyPipeline(session, options)` — async, fire-and-forget
  - **Stage 1 — Auto-Save Workflow:**
    - Guard: `config.autoSaveWorkflow !== false && session.capturedSteps?.length > 0`
    - Calls `saveWorkflow(session, { name: \`Auto: ${session.targetUrl}\` })`
    - Emits `pipeline_progress` with `{ stage: 'workflow_save', status: 'done', result: { workflowId, stepCount } }`
    - If skipped: emits `{ status: 'skipped', reason: 'no_captured_steps' }`
  - **Stage 2 — Auto-Generate Test Cases:**
    - Guard: `config.autoGenerateTests !== false && workflow saved`
    - Calls `generateTestCasesFromWorkflow(workflow, session.findings ?? [])`
    - Persists via `createTestCases(generated, { projectId, workflowId, targetUrl })`
    - Emits progress: `{ stage: 'test_generation', status: 'running' }` then `{ status: 'done', result: { count } }`
    - On LLM failure: `{ status: 'failed', error }` — pipeline continues to next stage
  - **Stage 3 — Auto Smoke Run (validate generated tests):**
    - Guard: `config.autoSmokeRun !== false && testCases.length > 0`
    - Runs `runTestSuite(testCases, { concurrency: 1, retries: 0 })` — quick, single-threaded, no retries
    - Emits: `{ stage: 'smoke_run', status: 'done', result: { passed, failed, total } }`
    - Purpose: validate the generated tests are runnable before scheduling them
  - **Stage 4 — Auto-Create Schedule:**
    - Guard: `config.autoCreateSchedule !== false && testCases.length > 0`
    - Calls `createSchedule({ name, cronExpr: config.defaultScheduleCron || '0 9 * * *', testCaseIds, targetUrl, projectId })`
    - Emits: `{ stage: 'schedule_create', status: 'done', result: { scheduleId, nextRun } }`
  - **Final: `pipeline_complete`** with summary `{ workflowId, testCaseCount, smokeResults, scheduleId }`
  - Error handling: each stage wrapped in try/catch, failures don't block subsequent stages, all failures reported in `pipeline_complete`

- Add config keys to `server/config.js`:
  ```
  autoSaveWorkflow: true       (default on)
  autoGenerateTests: true      (default on)
  autoSmokeRun: false          (default OFF — user opts in, since it launches a browser)
  autoCreateSchedule: true     (default on)
  defaultScheduleCron: '0 9 * * *'  (daily 9am)
  ```
  - Wire into `fromEnv()`: `QASE_AUTO_SAVE_WORKFLOW`, `QASE_AUTO_GEN_TESTS`, `QASE_AUTO_SMOKE_RUN`, `QASE_AUTO_CREATE_SCHEDULE`, `QASE_DEFAULT_CRON`
  - Expose in `getPublicConfig()` for the UI toggle
  - Save/load in `saveConfig()`

- Modify `server/qaTools.js`:
  - After `session.report = report; emit(session, 'report', ...)` in `finish_qa_report` handler
  - Add: `import { runAutonomyPipeline } from './pipeline.js'`
  - Call: `runAutonomyPipeline(session, {}).catch(() => {})` — fire-and-forget, errors don't crash the agent

- Modify `server/index.js`:
  - Forward `pipeline_start`, `pipeline_progress`, `pipeline_complete` events through SSE
  - Add `POST /api/sessions/:id/run-pipeline` — manual trigger (lets user re-run pipeline on any session)
  - Add `GET /api/sessions/:id/pipeline-status` — returns last pipeline result for the session

### 12B — Pipeline Progress UI + Settings
**Frontend: live progress visualization and autonomy toggle**

- Add pipeline progress panel to session detail (shown when `pipeline_*` events arrive):
  - 4 stage chips arranged horizontally: Workflow → Tests → Smoke → Schedule
  - Each chip: icon + label + status indicator (spinner=running, ✓=done, ⊘=skipped, ✕=failed, –=pending)
  - Detail text per stage (e.g., "3 test cases generated", "2/3 passed in smoke run")
  - Expandable summary on `pipeline_complete`
  - "Re-run Pipeline" button (calls `POST /api/sessions/:id/run-pipeline`)

- Add autonomy settings to Settings modal:
  - Section header: "Autonomy Pipeline"
  - Checkbox: "Auto-save workflow after report" (autoSaveWorkflow)
  - Checkbox: "Auto-generate test cases" (autoGenerateTests)
  - Checkbox: "Run smoke validation" (autoSmokeRun)
  - Checkbox: "Auto-create regression schedule" (autoCreateSchedule)
  - Text input: "Default schedule cron" (defaultScheduleCron) with preset dropdown

### 12C — Pipeline State Persistence + History
**Backend: store pipeline results so they survive restarts and can be reviewed**

- Extend `server/pipeline.js`:
  - Store pipeline results in `session.pipeline = { stages: [...], completedAt, summary }`
  - Persisted via `store.js` `emit()` → `persistSoon()`
- Store last pipeline result per session in sessions.json
- `GET /api/sessions/:id/pipeline-status` reads from session (not just in-memory)
- Frontend: on session load, if `session.pipeline` exists, render the completed pipeline state

---

## Acceptance Criteria

### 12A — Orchestrator
- [ ] `server/pipeline.js` exists with `runAutonomyPipeline()` function
- [ ] Pipeline auto-triggers from `finish_qa_report` tool (fire-and-forget)
- [ ] Stage 1 (auto-save workflow): saves workflow with auto-generated name when capturedSteps exist
- [ ] Stage 2 (auto-gen tests): generates and persists test cases from workflow + findings
- [ ] Stage 3 (auto-smoke, off by default): runs generated tests with concurrency=1, retries=0
- [ ] Stage 4 (auto-create schedule): creates daily schedule with generated test case IDs
- [ ] Each stage emits SSE `pipeline_progress` events
- [ ] `pipeline_complete` emitted with full summary
- [ ] Stage failures don't block subsequent stages
- [ ] Config flags control each stage independently
- [ ] 5 new env keys: QASE_AUTO_SAVE_WORKFLOW, QASE_AUTO_GEN_TESTS, QASE_AUTO_SMOKE_RUN, QASE_AUTO_CREATE_SCHEDULE, QASE_DEFAULT_CRON
- [ ] `POST /api/sessions/:id/run-pipeline` manual trigger works
- [ ] Integration tests: full pipeline run with mock LLM, stage skipping, failure recovery

### 12B — UI
- [ ] Pipeline progress panel appears in session detail when pipeline runs
- [ ] 4 stage chips with correct status icons
- [ ] Stage detail text shows results (counts, IDs)
- [ ] Autonomy settings section in Settings modal with 4 checkboxes + cron input
- [ ] Settings persist via PUT /api/config
- [ ] "Re-run Pipeline" button works
- [ ] No console errors

### 12C — Persistence
- [ ] Pipeline results stored on session object
- [ ] Pipeline state survives page reload (reads from session on load)
- [ ] `GET /api/sessions/:id/pipeline-status` returns stored result
- [ ] Integration test: pipeline → reload session → pipeline state intact

---

## Edge Cases
- **Session has 0 capturedSteps** → Stage 1 skipped, rest of pipeline skips (no workflow to generate from)
- **LLM fails to generate tests** → Stage 2 marked failed, Stage 3+4 skipped (no tests to run/schedule)
- **Smoke run has failures** → Stage 3 still "done" (status shows pass/fail count), schedule still created with all tests
- **Session has 0 findings** → Stage 2 still works (findings are optional input)
- **Pipeline already ran on session** → manual re-run overwrites `session.pipeline`
- **Smoke run launches browser** → only when `autoSmokeRun` is explicitly enabled (default off)
- **Duplicate schedules** → each pipeline run creates a new schedule (user can delete old ones)

## Test Plan
- Unit: `pipeline.js` stage functions with mocked dependencies
- Integration: full pipeline (mock LLM → workflow saved → tests generated → schedule created)
- Integration: stage failure isolation (LLM fails → pipeline continues, schedule not created)
- Integration: config flags (disable each stage, verify it's skipped)
- Integration: manual trigger via POST /api/sessions/:id/run-pipeline
- Browser: pipeline progress chips appear and update, settings toggles work
