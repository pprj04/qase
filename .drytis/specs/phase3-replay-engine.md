# Phase 3 — Test Case Replay Engine

## Goal
Run saved test cases deterministically against the target site using Playwright directly (no agent loop, no LLM cost). Each step is executed in sequence, assertions are validated, and failures capture screenshots for evidence.

## Architecture Decision
The replay engine uses **Playwright directly** — not the @cleanslate/sdk agent runtime. This is fast, deterministic, costs zero LLM tokens, and avoids the complexity of the agent's tool-gating system. A test case's steps already contain the exact selectors and actions to perform.

## Files to Change

### New: `server/replay.js`
- Launches a fresh Chromium browser per run
- Executes each test step (navigate, click, fill, select, key, scroll, hover, check, screenshot, diagnostics)
- Validates assertions (url_is, url_contains, element_visible, element_hidden, element_text, element_enabled, no_console_errors, no_failed_requests, status_code)
- Captures screenshots on failure
- Resolves credential placeholders via a local vault (session-scoped or provided as runtime credentials)
- Returns structured ReplayResult

### New: `server/replayStore.js`
- Persistence for replay run history (`.qase/replay-runs.json`)

### Modified: `server/index.js`
- Import replay functions
- Add routes: POST `/api/test-cases/:id/run`, POST `/api/test-cases/run` (batch), GET `/api/test-cases/:id/runs`

### Modified: `public/app.js`
- Add "Run" button on each test case card
- Add "Run All" button in the Tests tab
- Display run results inline: step-by-step pass/fail, assertion checks, screenshots for failures
- Run badge showing last result (pass/fail)

### Modified: `public/styles.css`
- Styles for run result rows, pass/fail badges, inline screenshots

## Data Models

### ReplayResult
```js
{
  id:           string (UUID),
  testCaseId:   string,
  testCaseName: string,
  ts:           number,
  result:       'pass' | 'fail' | 'error',
  durationMs:   number,
  stepResults:  StepResult[],
  assertionResults: AssertionResult[],
  screenshots:  Screenshot[],  // { stepIndex, label, dataUrl }
  error:        string | undefined
}
```

### StepResult
```js
{ stepIndex, action, status: 'pass'|'fail'|'skip', error?, durationMs }
```

### AssertionResult
```js
{ index, type, passed, actual, expected, description }
```

## Acceptance Criteria
- [ ] Running a test case executes each step in a real browser via Playwright
- [ ] Assertions validated: URL match, element visibility/hidden/text, console health, network health
- [ ] Failures capture a screenshot for evidence
- [ ] Credential placeholders resolved from stored secrets or provided credentials
- [ ] Batch runs return aggregate pass/fail counts
- [ ] Run history persists per test case (`.qase/replay-runs.json`)
- [ ] Results displayed inline in the dashboard with pass/fail indicators
