# B1: Interactive Exploration Bridge

## Problem

`captureStep()` in `server/workflows.js` records **what the agent did** (action, target, value, url) but never records **what happened after**. The outcome data *exists* in `agent.js` (`tool_result` handler knows success/failure, URL, title, console errors) but is written to ephemeral `session.activities` — never to the structured `capturedSteps` that downstream intelligence consumes.

This is the #1 accuracy bottleneck: purpose detection sits at 43% because the system can't tell what the app actually *does*, only what its URLs look like.

## Goal

Enrich every captured step with an `outcome` object so the intelligence layer can reason about behavioral evidence, not just structural metadata.

## Changes

### 1. `server/workflows.js` — `captureStep()` enhancement

- Accept `toolCallId` parameter (currently not passed)
- Store `toolCallId` on the step so results can be correlated
- Initialize `outcome: { status: 'pending' }` on every step

### 2. `server/workflows.js` — new `finalizeStepOutcome()`

```js
export function finalizeStepOutcome(session, toolCallId, toolName, result)
```

Finds the step by `toolCallId`, extracts outcome from result:

```js
{
  status: 'success' | 'failed',
  urlAfter: string | null,       // post-action URL if changed from step.url
  titleAfter: string | null,     // page title after action
  error: string | null,          // error message if failed
  elementsFound: number | null,  // element count from snapshot
  consoleErrors: number | null,  // console error count from diagnostics
  networkErrors: number | null,  // failed request count from diagnostics
  dialogAppeared: boolean,        // alert/confirm dialog detected in result
  ts: number                      // when outcome was recorded
}
```

Emits `step_outcome` SSE event for live dashboard updates.

### 3. `server/agent.js` — wire the result back

- Pass `toolCallId` to `captureStep()` in `beginActivity()`
- In `tool_result` handler, call `finalizeStepOutcome(session, toolCallId, toolName, result)`
- Un-redacted result is fine — `finalizeStepOutcome` only reads structural fields (url, title, element counts), never values

### 4. `server/store.js` — session serialization

No changes needed — `capturedSteps` is already serialized and restored. The new fields travel with it automatically.

## Acceptance Criteria

- [ ] Every step in `capturedSteps` has a `toolCallId` field
- [ ] Every step has an `outcome` object (pending on creation, finalized after tool_result)
- [ ] Outcome captures: status (success/failed), urlAfter, titleAfter, error
- [ ] Outcome captures element count from snapshot results
- [ ] Outcome captures console/network error counts from diagnostics results
- [ ] `finalizeStepOutcome` is a no-op (not a crash) when no matching step is found
- [ ] `finalizeStepOutcome` handles null/undefined result gracefully
- [ ] Steps without a matching tool_result (agent interrupted) keep `status: 'pending'`
- [ ] `step_outcome` SSE event emitted on finalization
- [ ] Unit tests cover: success outcome extraction, failure outcome, snapshot enrichment, diagnostics enrichment, no-match safety, null-result safety, url-change detection

## Tests

File: `tests/test-interactive-exploration.js`

Test cases:
1. `captureStep` creates step with `outcome: { status: 'pending' }` and `toolCallId`
2. `finalizeStepOutcome` updates status to 'success' when result.success !== false
3. `finalizeStepOutcome` updates status to 'failed' with error message when result.success === false
4. Snapshot results enrich outcome with `elementsFound` count
5. Diagnostics results enrich outcome with `consoleErrors` and `networkErrors` counts
6. URL change detected when result.url differs from step.url
7. No-op when toolCallId not found in capturedSteps
8. No crash when result is null/undefined
9. Steps remain 'pending' when finalizeStepOutcome never called (agent interrupted)
10. Dialog detection from result (alert/confirm text in result)

## Out of Scope

- B2 (consuming outcomes in intelligence layer) — separate task
- Dashboard UI changes to display outcomes — future enhancement
- Replay engine changes — outcomes are for intelligence, not test replay
