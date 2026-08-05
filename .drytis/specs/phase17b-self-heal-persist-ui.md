# Phase 17B — Self-Healing: Auto-Repair + Re-Run + UI

## Goal
When self-healing succeeds (healed test passes on retry), persist the fix to the stored test case permanently. Show healing badges and details in the test result UI. Add settings controls.

## Changes

### server/replay.js
- Import `updateTestCase` from testCases.js (no circular dep — testCases.js doesn't import replay.js)
- `runWithRetry()`:
  - Added `healingApplied` + `healedSteps` tracking variables
  - On heal success: sets `healingApplied = true`, saves `healedSteps = testCase.steps`
  - On pass after healing: calls `updateTestCase(testCase.id, { steps: healedSteps })` to persist fix, sets `result.healed = true`
  - Console log confirms persistence

### public/tests.js
- Added 💚 HEALED badge in test result banner (green, next to flaky badge)
- Added "Self-Healing" detail section showing heal records:
  - Action type (click, fill, etc.)
  - Old selector (strikethrough, red)
  - → arrow
  - New selector (green)
  - Confidence percentage with hover tooltip showing reason

### public/index.html
- New "Self-Healing Tests" settings section between Autonomy Pipeline and BrowserStack
  - Enable checkbox (id: cfg-self-heal-enabled)
  - Confidence threshold number input 0-1 (id: cfg-self-heal-threshold)

### public/app.js
- Added cfg refs: selfHealEnabled, selfHealThreshold
- fillSettings() populates from config
- readSettings() sends to API

### public/styles.css
- `.tc-healed-badge` — green badge matching flaky badge style
- `.tc-heal-record` — flex row with old→new selector display
- `.tc-heal-old` — red strikethrough monospace
- `.tc-heal-new` — green monospace
- `.tc-heal-conf` — confidence percentage

### server/config.js (from 17A)
- selfHealEnabled, selfHealThreshold in all config functions

## Acceptance Criteria
- [x] Healed selectors persist to test case on successful heal (updateTestCase called)
- [x] result.healed = true flag set on healed passes
- [x] 💚 HEALED badge shows in test result banner
- [x] Healing detail section shows old→new selector with confidence
- [x] Settings dialog has Self-Healing section with enable toggle + threshold
- [x] fillSettings/readSettings handle self-heal fields
- [x] All modules compile clean
- [x] 63/63 tests pass
- [x] Config API serves selfHealEnabled + selfHealThreshold
