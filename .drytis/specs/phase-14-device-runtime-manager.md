# Phase 14 · Device Runtime Manager: levels, honest labeling, provider abstraction

## Goal
A server-side Device Runtime Manager (DRM) between QASE and execution: resolves each environment to an execution level (SIMULATED / VIRTUALIZED / REAL DEVICE), routes execution through a Device Runtime Provider interface, stamps every run with verified execution metadata, and NEVER silently downgrades.

## Provider interface (server/deviceRuntime/provider.js)
`create_session()`, `get_device()`, `start_session()`, `execute_test()`, `capture_screenshot()`, `capture_video()`, `capture_logs()`, `collect_device_information()`, `stop_session()`.

Providers:
1. `localChromiumProvider` — full Playwright context emulation (Level 1 SIMULATED): UA from device profile, viewport+DPR+isMobile+hasTouch, touch-interaction input mode (tap/double-tap/swipe/long-press/drag/pinch via touchscreen API), orientation incl. mid-test rotate, permission scenarios applied via `context.grantPermissions` + CDP `Browser.setPermission` (camera/mic/notifications/location; DENY = override + revoke), network conditioning via CDP `Network.emulateNetworkConditions` where supported.
2. `browserstackProvider` (adapter over existing server/browserstackProvider.js) — Level 3 REAL DEVICE when env.executionProvider==='browserstack' AND credentials set AND caps carry deviceName/realMobile. **collect_device_information() must verify** the session's device/os/browser actually match the request (BrowserStack session details API); a mismatch or unavailable verification demotes honestly to VIRTUALIZED (cloud browser) or fails.
3. `stubRemoteLabProvider` — registered-but-unconfigured reference implementation for internal/remote device labs; reports all devices OFFLINE until configured. Proves the abstraction is not BrowserStack-coupled.

## Execution level resolution (server/deviceRuntime/manager.js)
- `resolveExecutionLevel(env, providers)` → { level: 'real'|'virtualized'|'simulated', providerId, verified: boolean, reason }
- Local mode: everything is SIMULATED. Environments whose executionProvider is browserstack but creds missing → level stays SIMULATED + `requestedReal: true`, and the run report must say "NOT AVAILABLE FOR REAL EXECUTION (reason)".
- Never return level 'real' unless `collect_device_information()` verification passed.

## Run stamping
- Session record gains `deviceSession` block: { sessionId: 'QASE-XXXX', level, providerId, verified, requestedLevel, device/os/browser as-executed (from verification), permissions scenario applied, orientation, startedAt, status }.
- Legacy `environment_snapshot` untouched (backward compat). `qa_runs` gains `device_session jsonb` (migration 019, same file as Phase 13).
- Agent loop (server/agent.js + browserBridge.js): `ensureContext` routes through the DRM; evidence events gain `deviceSession` metadata; screenshots/video/logs captured through provider methods carry it.
- Removal of silent downgrade: browserBridge.js:104-106 fallback now sets requestedLevel/verified:false and surfaces in UI + report.

## Acceptance criteria (running app)
- [ ] Local run with iPhone 16 Pro env → run header shows SIMULATED chip + tooltip "Real device unavailable: no real-device provider configured"; report states execution level
- [ ] With BrowserStack creds: iOS+realMobile env → REAL DEVICE chip only when session verification matches; report shows as-executed device/os/browser
- [ ] BrowserStack available but cloud-browser env (macOS chrome) → VIRTUALIZED, never labeled real
- [ ] `collect_device_information` mismatch → level demoted + finding recorded, not silently passed
- [ ] Evidence/artifact events in a run's activity stream include deviceSession metadata
- [ ] Stub lab provider appears in provider list as OFFLINE; zero devices claim real
- [ ] Existing runs (no deviceSession) render unchanged

## Edge cases
- Provider timeout/unreachable at start → explicit error, no fake level
- Verification API failure post-launch → mark verified:false, level capped at VIRTUALIZED
- Concurrent sessions exhausting a real-device slot → queue (Phase 16) not silent failure

## Tests
Unit: level resolution matrix (creds×provider×env), provider contract tests (fake provider), stamping on both stores, agent integration test with fake DRM.
