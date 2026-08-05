# Phase 16D — BrowserStack Integration

## Goal
Integrate BrowserStack cloud for cross-browser test execution. When enabled, the replay engine connects to BrowserStack via CDP instead of launching local Chromium, running tests on cloud-hosted Chrome/Firefox/Safari.

## Architecture
- **Replay engine only** — the interactive agent stays on local Chromium (SDK-controlled)
- **CDP connection** — `chromium.connectOverCDP(wss://cdp.browserstack.com/playwright?caps=...)`
- **Graceful fallback** — if BS unavailable, falls back to local Chromium with warning
- **Per-test connections** — each test connects and disconnects individually

## Changes

### Backend (16D-A + 16D-B)
- **config.js**: Added `browserstackEnabled`, `browserstackUser`, `browserstackKey`, `browserstackBrowsers` to fromEnv(), DEFAULTS, getPublicConfig() (key hidden), saveConfig() whitelist
- **replay.js**:
  - `launchBrowser({ browser, testName })` — when BS enabled + creds present, connects via CDP with browser-specific caps; falls back to local on failure
  - `BROWSERSTACK_OS_MAP` — maps browser names to BS capabilities (Chrome/Firefox on OS X Sonoma, Safari on OS X)
  - `runTestCase()` — accepts `browser` param, passes to launchBrowser, includes `browser` in result object
  - `runWithRetry()` — passes `browser` through
  - `runTestSuite()` — accepts `browsers` param, expands entries per browser × viewport
- **index.js**: Both run endpoints (single + bulk) accept `browser`/`browsers` params

### Frontend (16D-C)
- **index.html**: BrowserStack settings section in settings dialog (enable toggle, browsers input, username, key + clear)
- **app.js**: cfg object refs, fillSettings() populates BS fields, readSettings() sends BS fields, clear key handler
- **shared.js**: el refs for all BS config elements
- **tests.js**: Browser badge in test result banner (🌐 chrome, 🦊 firefox, 🧭 safari)
- **styles.css**: `.tc-browser-badge` styling

### Env Keys
- `QASE_BROWSERSTACK_ENABLED` (true)
- `QASE_BROWSERSTACK_USER` (tRuEje)
- `QASE_BROWSERSTACK_KEY` (secret)
- `QASE_BROWSERSTACK_BROWSERS` (chrome)

## Acceptance Criteria
- [x] BrowserStack settings section visible in Settings dialog
- [x] Enable toggle, browsers, username, key inputs all present
- [x] Config save (PUT /api/config) persists BS fields
- [x] Config load (GET /api/config) exposes BS fields (key hidden)
- [x] launchBrowser() routes to BS CDP when enabled, falls back to local on failure
- [x] runTestSuite() expands tests per browser when BS enabled
- [x] Test results include `browser` field
- [x] Browser badge shows on test result banner
- [x] All backend modules compile without errors
- [x] All frontend modules compile without errors
