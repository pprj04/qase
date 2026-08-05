# Phase 17A — Self-Healing: Failure Analysis Engine

## Goal
When a test step fails because a CSS selector broke (element moved, class renamed, DOM structure changed), the engine automatically captures the page DOM, asks the LLM to find the replacement element, patches the test case, and retries with the healed selector.

## Architecture
```
runTestSuite → runWithRetry → runTestCase (fails)
                                  ↓
                          captures DOM snapshot
                                  ↓
                          runWithRetry calls analyzeFailure()
                                  ↓
                          LLM finds new selector
                                  ↓
                          patchTestCase (deep clone)
                                  ↓
                          retry with healed selector
                                  ↓
                          if pass → mark healed ✓
```

## Changes

### server/selfHeal.js (new, 249 lines)
- `isSelectorFailure(stepResult)` — classifies whether a failure is a broken selector (9 timeout/not-found patterns matched against error message; only selector-based actions: click/fill/type/select/check/hover/scroll)
- `capturePageDom(page)` — extracts concise DOM snapshot (up to 300 interactive elements: buttons, inputs, links, data-testid elements) via page.evaluate()
- `analyzeFailure(testCase, failedStep, domSnapshot, errorMessage)` — calls callLLM with system prompt explaining the task, returns `{ newSelector, confidence, reason }`
- `parseHealResponse(raw)` — robust JSON extraction from LLM response (handles code fences, extra text)
- `patchTestCase(testCase, stepIndex, newSelector)` — deep-clones test case, patches the failed step's target, marks with `_healed` + `_originalTarget` flags
- `createHealRecord(failedStep, analysis, stepIndex)` — creates audit record for storage

### server/replay.js
- Import `isSelectorFailure, capturePageDom, analyzeFailure, patchTestCase, createHealRecord`
- `runTestCase()` — on step failure, if `isSelectorFailure()` returns true, captures DOM snapshot via `capturePageDom(page)` and attaches to result as `_domSnapshot` / `_failedStepIndex` / `_failedStep`
- `runWithRetry()` — between first failure and retry, if self-heal enabled and DOM snapshot exists:
  1. Calls `analyzeFailure()` with the DOM + failed step context
  2. If `confidence >= threshold`, calls `patchTestCase()` to create healed copy
  3. Records healing event in `result.healRecords`
  4. Retries with patched test case
- `cleanHealArtifacts(result)` — strips internal `_domSnapshot` etc. before returning result

### server/config.js
- Added `selfHealEnabled` (default true) and `selfHealThreshold` (default 0.8) to fromEnv(), DEFAULTS, getPublicConfig(), saveConfig()

### Env Keys
- `QASE_SELF_HEAL` (true)
- `QASE_SELF_HEAL_THRESHOLD` (0.8)

## Acceptance Criteria
- [x] isSelectorFailure correctly identifies selector timeouts vs network/assertion failures
- [x] capturePageDom extracts interactive elements without crashing
- [x] analyzeFailure returns JSON with newSelector, confidence, reason
- [x] patchTestCase deep-clones and patches without mutating original
- [x] createHealRecord produces audit trail
- [x] runTestCase captures DOM on selector failure (before browser closes)
- [x] runWithRetry attempts healing between first failure and retry
- [x] Healing only triggers on first attempt (not every retry)
- [x] Internal _domSnapshot cleaned from final result
- [x] Config exposes selfHealEnabled + selfHealThreshold
- [x] All modules compile without errors
- [x] 8/8 unit tests pass
