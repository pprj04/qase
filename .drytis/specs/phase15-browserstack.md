# Phase 15 — BrowserStack & Cross-Browser Testing

## Problem
Replay engine uses local `chromium.launch()` only — no cross-browser coverage. BrowserStack is referenced in the roadmap but never integrated. There's no way to test on Firefox, Safari/WebKit, or real mobile devices.

## Target
Integrate BrowserStack via `chromium.connectOverCDT()` for replay runs. Enable a browser matrix (Chrome, Firefox, Safari) on regression schedules. Cross-browser badges in the UI.

---

## Architecture

### Files to Modify
1. **`server/replay.js`** — Add BrowserStack CDP connection path
2. **`server/scheduler.js`** — Browser matrix in schedules
3. **`server/config.js`** — BrowserStack credentials + browser presets
4. **`server/index.js`** — Routes for browser matrix config
5. **`public/app.js`** — Browser matrix selector in schedule form, cross-browser badges
6. **`public/styles.css`** — Browser badge styles

---

## Sub-Phases

### 15A — BrowserStack CDP Integration
- Add to `server/config.js`:
  - `browserstackUser` (from `QASE_BROWSERSTACK_USER`)
  - `browserstackKey` (from `QASE_BROWSERSTACK_KEY`, is_secret)
  - `browserstackEnabled` (from `QASE_BROWSERSTACK_ENABLED`, default false)
- Modify `server/replay.js`:
  - In `ensureBrowser()` / browser launch path:
    ```javascript
    if (config.browserstackEnabled && config.browserstackUser) {
      const caps = 'browserstack:tunnel?true';
      const cdpUrl = `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(JSON.stringify({
        browser: browserType,  // 'chrome' | 'firefox' | 'safari'
        os: osName,
        os_version: osVersion,
        'browserstack.user': config.browserstackUser,
        'browserstack.key': config.browserstackKey,
        name: testRunName
      }))}`;
      browser = await chromium.connectOverCDP(cdpUrl);
    } else {
      browser = await chromium.launch({ headless: config.headless });
    }
    ```
  - Fallback to local chromium if BrowserStack fails (network error, invalid creds)

### 15B — Browser Matrix in Schedules
- Extend `server/scheduler.js` schedule object:
  - `browsers: ['chrome', 'firefox', 'safari']` (default: `['chrome']`)
- In `executeSchedule()`:
  - For each browser in schedule.browsers:
    - Set the browser type in the BrowserStack capabilities
    - Run the test suite
    - Store per-browser results in regression run
- Regression store: `results: { chrome: {...}, firefox: {...}, safari: {...} }`

### 15C — UI Cross-Browser Controls
- Schedule form: browser multi-select (checkboxes for Chrome/Firefox/Safari)
- Test results: browser badge per result (Chrome 🟢 / Firefox 🟢 / Safari 🔴)
- Regression trend: optional browser filter
- Settings: BrowserStack credentials section (username + access key)
- Status indicator: "BrowserStack connected" badge when credentials valid

---

## Acceptance Criteria
- [ ] BrowserStack CDP connection works when credentials provided
- [ ] Local chromium fallback when BrowserStack disabled or fails
- [ ] Schedule `browsers` field selects cross-browser execution
- [ ] Per-browser results stored and displayed
- [ ] Settings modal has BrowserStack credentials section
- [ ] 2 env keys: QASE_BROWSERSTACK_USER, QASE_BROWSERSTACK_KEY
- [ ] Integration tests: mock CDP connection, fallback path
- [ ] Browser tests: browser matrix selector, cross-browser badges

## Risk Assessment
- BrowserStack requires valid credentials (user must provide)
- CDP connection adds latency vs local chromium
- Free tier has limited minutes
- Safari via BrowserStack may have Playwright limitations (trace/video)
- If no credentials: feature gracefully degrades to local chromium only
