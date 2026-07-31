# Phase 9A — CI/CD Pipeline Integration

## Goal

Make Qase CI-native: JUnit XML export for CI consumption, API token auth for external triggers, and a health endpoint.

## Acceptance Criteria

### JUnit XML Export
- [ ] `GET /api/regression/runs/:id?format=junit` returns valid JUnit XML for a regression run
- [ ] `POST /api/test-cases/run?format=junit` runs test cases and returns JUnit XML (for CI: trigger + get results in one call)
- [ ] JUnit XML includes: testsuite name, testcase name, time (seconds), failure message, system-out with screenshot count
- [ ] Flaky tests (future Phase 9B) would appear as passing with a note in system-out

### API Token Auth
- [ ] `QASE_API_TOKEN` env var supported
- [ ] Auth middleware on mutating endpoints: POST /api/test-cases/run, POST /api/test-cases/:id/run, POST /api/schedules/:id/run
- [ ] Auth middleware on JUnit XML endpoints (same endpoints above)
- [ ] When token is set, requests without `Authorization: Bearer <token>` header get 401 on protected routes
- [ ] When token is NOT set, all routes remain open (backwards compatible, single-user local tool)
- [ ] Read-only GET routes (config, sessions list, test cases list, dashboard, health) remain open regardless
- [ ] Token manageable in Settings dialog (shows hint, regenerate)

### Health Endpoint
- [ ] `GET /api/health` returns `{ status: "ok", uptime: seconds, project: name }`
- [ ] No auth required — for liveness probes
- [ ] Returns 200 even if model isn't configured (health = server is up, not ready)

## Files to Create
- `server/junit.js` — JUnit XML builder from run summary

## Files to Modify
- `server/index.js` — auth middleware, JUnit routes, health endpoint, config routes for API token
- `server/config.js` — add apiToken to getConfig/getPublicConfig/saveConfig
- `public/index.html` — API token field in Settings
- `public/app.js` — API token read/write in Settings
- `public/styles.css` — minor adjustments if needed
