# Phase 1 — Workflow Capture & Persistence

## Goal
When the agent tests a site, every browser action (click, fill, navigate, etc.) gets captured as a structured "workflow step" that persists with the session. Users can review the step timeline and save named workflows for reuse.

## Files to Change

### New: `server/workflows.js`
- `BROWSER_ACTIONS` — set of tool names that produce workflow steps
- `STEP_ACTIONS` — maps SDK tool names to clean action verbs (browser_click → click, browser_fill → fill, etc.)
- `extractTarget(input)` — pulls the best identifying info from tool input (selector, name, text, role, url, key)
- `captureStep(session, { toolName, input })` — converts a browser tool call into a WorkflowStep, appends to `session.capturedSteps`, emits `workflow_step` SSE event
- `saveWorkflow(session, { name, tags })` — promotes captured steps into a named Workflow, persists to `.qase/workflows.json`
- `listWorkflows(targetUrl?)`, `getWorkflow(id)`, `deleteWorkflow(id)`, `updateWorkflow(id, patch)`
- Loads/saves `.qase/workflows.json` on disk

### Modified: `server/store.js`
- Add `capturedSteps: []` to session shape in `createSession()`

### Modified: `server/agent.js`
- Import `captureStep` from workflows.js
- Call `captureStep()` inside `beginActivity()` for browser_* tools only (the input is already redacted at that point)

### Modified: `server/index.js`
- Import workflow functions
- Add routes: GET/POST `/api/sessions/:id/workflow`, GET `/api/workflows`, GET/PUT/DELETE `/api/workflows/:id`

### Modified: `public/index.html`
- Add "Workflows" tab button in the right panel tabs
- Add tab pane `<section data-pane="workflows">`

### Modified: `public/app.js`
- Add `el.workflowList`, `el.countWorkflows` references
- Add `renderWorkflows()` — renders captured steps as a timeline with checkboxes
- Add `workflow_step` SSE event handler
- Add "Save as Workflow" button with name input
- Add saved workflows list (filtered by targetUrl)

### Modified: `public/styles.css`
- Styles for workflow step timeline, step icons, save form

## Data Models

### WorkflowStep
```js
{
  id:      string (UUID),
  ts:      number,
  action:  string,     // navigate|click|fill|select|check|type|key|scroll|hover|screenshot|diagnostics|snapshot|wait
  target:  string|undefined,  // CSS selector, element name, text, or URL
  label:   string,     // human-readable: "Clicked Sign in", "Filled email = test@test.com"
  value:   string|undefined,  // for fill/type/select/key (credential placeholders preserved)
  url:     string|undefined   // page URL at time of step
}
```

### Saved Workflow
```js
{
  id:         string (UUID),
  sessionId:  string,
  name:       string,
  targetUrl:  string,
  steps:      WorkflowStep[],
  tags:       string[],
  createdAt:  number,
  updatedAt:  number
}
```

## Acceptance Criteria
- [ ] Browser actions during a run are captured as structured steps
- [ ] Steps visible in the dashboard's new Workflows tab during and after a run
- [ ] User can save captured steps as a named workflow
- [ ] Saved workflows persist across container restarts (`.qase/workflows.json`)
- [ ] Workflows listable and filterable by target URL
- [ ] Credential placeholder text (`{{QA_PASSWORD}}`) preserved in steps — real secrets never stored
- [ ] New `workflow_step` SSE event updates the UI live without page reload
