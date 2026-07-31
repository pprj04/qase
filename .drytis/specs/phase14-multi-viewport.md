# Phase 14 — Multi-Viewport / Responsive Testing

## Problem
The agent explores at a single hardcoded viewport (1440×900). Tests are generated and replayed at the same fixed size. There's no coverage for tablet or mobile breakpoints, no way to verify responsive design, and no viewport metadata on test cases.

## Target
Test cases support per-test viewport configuration. The replay engine runs tests across specified viewports. The agent explores responsive breakpoints. The UI shows viewport badges and selectors.

---

## Architecture

### Files to Modify
1. **`server/replay.js`** — Multi-viewport execution in `runTestSuite`
2. **`server/testCases.js`** — Add `viewport` and `viewports[]` fields
3. **`server/testGen.js`** — Generate viewport-aware test cases
4. **`server/agent.js`** — Add responsive exploration pass after main exploration
5. **`server/config.js`** — Viewport presets
6. **`public/app.js`** — Viewport badges, selector in test case editor, multi-viewport results
7. **`public/index.html`** — Editor viewport dropdown
8. **`public/styles.css`** — Viewport badge styles

---

## Sub-Phases

### 14A — Viewport Presets + Test Case Schema
- Add to `server/config.js`:
  ```javascript
  VIEWPORT_PRESETS: {
    desktop: { width: 1440, height: 900, label: 'Desktop', icon: '🖥️' },
    tablet: { width: 768, height: 1024, label: 'Tablet', icon: '📋' },
    mobile: { width: 375, height: 812, label: 'Mobile', icon: '📱' },
    mobile_small: { width: 320, height: 568, label: 'Mobile S', icon: '📱' }
  }
  ```
- Extend test case schema in `server/testCases.js`:
  - `viewport: { width, height }` — single viewport (default: desktop preset)
  - `viewports: [{ width, height }]` — multiple viewports for multi-viewport tests
  - `normalizeTestCase()` applies desktop default if neither is set
- Extend test case editor UI:
  - Viewport dropdown in the editor (single-select with preset names)
  - "Multi-viewport" checkbox → reveals multi-select chips

### 14B — Replay Engine Multi-Viewport
- Modify `server/replay.js` `runTestSuite`:
  - For each test case, check `viewports[]` or fallback to single `viewport`
  - If multiple viewports: run the test once per viewport, aggregate results
  - Result object includes `viewportResults: [{ viewport, result, duration }]`
  - The test's overall result is `fail` if ANY viewport fails (conservative)
- Modify JUnit XML output to include viewport in test name: `[Mobile] Test login flow`
- Modify regression store to track per-viewport results

### 14C — Agent Responsive Exploration
- Add a responsive exploration pass to `server/agent.js`:
  - After main exploration (desktop), if `config.exploreViewports` is enabled:
  - Resize browser to tablet → screenshot → check for layout breaks
  - Resize to mobile → screenshot → check for layout breaks
  - File findings for responsive issues (category: "responsive")
  - Capture steps at each viewport for workflow/test generation
- Update agent prompt to instruct responsive awareness
- Add config: `exploreViewports: true` (default on)

### 14D — UI Viewport Indicators
- Test case cards: viewport badge (🖥️/📋/📱) next to severity badge
- Test results: per-viewport result breakdown in expanded card
- Regression trend chart: optional viewport filter
- Test case editor: viewport selector as described in 14A

---

## Acceptance Criteria
- [ ] Test cases have `viewport` and `viewports[]` fields
- [ ] Replay engine runs tests at specified viewport(s)
- [ ] Multi-viewport tests produce per-viewport results
- [ ] Agent explores at tablet + mobile breakpoints when enabled
- [ ] UI shows viewport badges on test cards
- [ ] Editor has viewport selector
- [ ] Integration tests: multi-viewport run produces correct result aggregation
- [ ] Browser tests: viewport badges render, editor selector works
