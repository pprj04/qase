# Phase 2 — Test Case Generation from Workflows

## Goal
Convert a saved workflow into structured test cases with assertions. An LLM analyzes the workflow steps and produces replayable test cases that can be validated in Phase 3 (Replay Engine).

## Architecture Decision
Test case generation makes a **direct LLM API call** (OpenAI-compatible `/chat/completions`) rather than spinning up the full agent runtime (which includes a browser). This is simpler, faster, and cheaper — the task is structured data generation, not browser interaction.

## Files to Change

### New: `server/testCases.js`
- CRUD + persistence for test cases (`.qase/test-cases.json`)
- `generateTestCases(workflow)` — calls LLM, parses JSON response, creates TestCase records

### New: `server/testGen.js`  
- `callLLM(systemPrompt, userPrompt)` — direct OpenAI-compatible API call using config from config.js
- `buildTestCasePrompt(workflow, findings)` — constructs the system + user prompts
- `parseTestCases(rawText)` — robustly extracts JSON from LLM response

### Modified: `server/index.js`
- Import test case functions
- Add routes: POST `/api/workflows/:id/generate-tests`, GET/PUT/DELETE `/api/test-cases/:id`, GET `/api/test-cases`

### Modified: `public/app.js`
- Add "Generate Test Cases" button on each saved workflow
- New "Test Cases" tab in the right panel (6th tab)
- Render test cases with steps + assertions in an expandable card view
- Inline editing of steps and assertions
- Delete test case

### Modified: `public/index.html`
- Add Test Cases tab button + pane

### Modified: `public/styles.css`
- Styles for test case cards, step lists, assertion badges, generate button

## Data Models

### TestCase
```js
{
  id:            string (UUID),
  workflowId:    string,
  name:          string,
  targetUrl:     string,
  preconditions: string[],
  steps:         TestStep[],
  assertions:    Assertion[],
  severity:      string,    // critical|high|medium|low
  createdAt:     number,
  updatedAt:     number,
  lastRun:       undefined  // populated in Phase 3
}
```

### TestStep
```js
{ action: string, target: string|undefined, value: string|undefined, description: string }
```

### Assertion
```js
{ type: string, target: string|undefined, expected: string, description: string }
```

## Acceptance Criteria
- [ ] Clicking "Generate Test Cases" on a workflow triggers LLM-based generation
- [ ] Generated test cases contain structured steps + at least one assertion per critical step
- [ ] Test cases are editable (rename, modify steps, add/remove assertions)
- [ ] Test cases persist across restarts (`.qase/test-cases.json`)
- [ ] Test Cases tab renders the generated test cases with steps and assertions
- [ ] Test cases can be deleted
- [ ] LLM errors are surfaced gracefully in the UI
