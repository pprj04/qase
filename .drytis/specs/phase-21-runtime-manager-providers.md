# Phase 21 · Device Runtime Manager + Provider abstraction + sessions

## Goal
The control plane: a `DeviceRuntimeManager` owns device availability, session
lifecycle and queueing; a `DeviceRuntimeProvider` interface abstracts the
execution substrate. Three concrete providers ship now:
`LocalSimulationProvider` (Playwright emulation — what exists today, now
labeled SIMULATED), `BrowserStackProvider` (VIRTUALIZED or REAL DEVICE per
its `realMobile` attestation), and a `NullRealDeviceProvider` (reports
NOT AVAILABLE FOR REAL EXECUTION until a lab is connected). Never pretend.

## Provider interface (per request)
create_session(), get_device(), start_session(), execute_test(),
capture_screenshot(), capture_video(), capture_logs(),
collect_device_information(), stop_session()

## Files
- `server/deviceRuntime/` (new package):
  - `provider.js` — interface contract + capability descriptors
    (supportedLevels, canRotate, permissionsSupported…)
  - `localSimulationProvider.js` — wraps existing browserBridge ensureContext
    path; level = SIMULATED
  - `browserstackRuntimeProvider.js` — wraps existing browserstackProvider;
    level = VIRTUALIZED; REAL DEVICE only when the provider returns a device
    session attestation (realMobile + deviceName) — otherwise VIRTUALIZED
  - `nullRealDeviceProvider.js` — honest "not available" for physical labs
  - `manager.js` — availability registry (AVAILABLE/BUSY/OFFLINE),
    queue with position + auto-start, session registry (QASE-DR-XXXX ids),
    explicit fallback resolution (Queue Real Device / Run Virtualized / Run
    Simulated — user choice, never silent downgrade)
- `server/app.js` — REST: GET /api/device-runtime/devices (status board
  data), POST /api/device-runtime/sessions, GET /:id (queue position,
  progress), POST /:id/cancel, fallback choice endpoints
- `server/agent.js` — run start consults the manager instead of calling
  resolveExecution directly

## Device Session record
{ sessionId: QASE-DR-XXXX, environment, level, status: queued|running|done,
  queuePosition?, startedAt, linkedRunId, linkedTestCaseId, evidence: [],
  logs: [], provider }

## Acceptance criteria
- [ ] With BrowserStack creds absent (current state), requesting REAL DEVICE
      for iPhone 16 Pro returns NOT AVAILABLE FOR REAL EXECUTION + the three
      fallback choices — no run starts as "real".
- [ ] Queue: request a busy device → session created with position + status
      queued; releasing a device auto-starts the next queued session.
- [ ] Session list is queryable; each session links run + test case.
- [ ] Simulated sessions (bulk wizard, one-click run) execute exactly as
      today but are labeled SIMULATED end-to-end.
- [ ] npm test green; unit tests for queue behavior, fallback resolution,
      level attestation rules.

## Edge cases
- Provider crash mid-session → session marked failed with reason; queue
  advances; no stuck BUSY devices.
- Two sessions request the last available device → one wins, other queues.
- Cancellation while queued removes cleanly; while running releases device.
