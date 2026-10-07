# Phase 23 · Device Matrix as control layer: statuses, one-click, queue UX, bulk, fallback

## Implementation notes (grounded in code exploration 2026-09-29)

### Current state (verified)
- `public/deviceMatrixView.js` (577 lines): environments tab (`renderEnvironments()` ~line 334) builds rows with cells [envId, device, os+osVersion, browser, browserVersion, screenResolution, orientation, provider] + toggle/edit. **No availability/level/last-tested columns.** `refreshEnvironments()` fetches `/api/environments?...`.
- `public/deviceDrawer.js` (566 lines): `renderSaved()` (~line 418) saved-env rows: Run button only sets `state.defaultEnvId` + localStorage + toast — **does not start a run**. No availability/level display.
- `public/app.js` run card (~line 345): env pill + Phase 22 `run-exec-level-badge` already render. Run creation: `createQaRun({ targetUrl, environmentId })`.
- `public/index.html`: Device Matrix dialog `#device-matrix` (line 360); environments table headers at line 408 (`<th>Environment</th>...<th>Provider</th><th></th>`); drawer `#device-drawer`; dialogs section near line 425.
- Backend READY (Phases 21/22 done): `GET /api/device-runtime/devices` → `{ devices: [{envId, device, platform, osVersion, browser, status AVAILABLE|BUSY|OFFLINE, maximumLevel, currentSessionId, queueLength, lastTestedAt, lastResult}], providers }`; `POST /api/device-runtime/sessions` `{environment|environmentId, requestedLevel, linkedRunId, allowQueue}` → `{status: started|queued|busy|not_available|failed, session?, choices?}`; `GET /api/device-runtime/sessions?status=`; `POST /api/device-runtime/sessions/:id/cancel`.
- Sessions list (`GET /api/sessions`) carries `environmentId`, `executionLevel`, `runtimeFacts` — joinable for Last Tested/Last Result columns.

### Build plan
1. **New `public/deviceRuntimeUi.js`** (DOM-free helpers + tests):
   - `AVAILABILITY_META` / `availabilityMeta(status)` → {label, dot, title}
   - `executionTypeLabel(maximumLevel)` → 'Real device'|'Virtualized'|'Simulated'|'Not executable (real)'
   - `fallbackOptionsFor(boardEntry, requestedLevel)` → {available, reason, options:[{action: queue|run_real|run_virtualized|run_simulated, level, label, description}]}; REAL only when maximumLevel attests; SIMULATED always offered; BUSY → queue option first
   - `describeQueue(session)`, `boardByEnvId(devices)`, `lastRunByEnv(runs)`, `formatWhen(value)`
2. **index.html**: environments thead gains `<th>Execution</th><th>Availability</th><th>Last tested</th><th>Last result</th>` + Run column; new `<dialog id="exec-fallback">` (reason text + option buttons + cancel); queue panel container in run header area (`#run-queue-panel`).
3. **deviceMatrixView.js**: `refreshRuntimeBoard()` fetches `/device-runtime/devices` + `/sessions?limit=100` → `boardByEnvId` + `lastRunByEnv`; `renderEnvironments()` adds 4 cells + availability dot (span.avail-dot data-state) + Run button → one-click flow (callback `onRunEnvironment(env)` injected via options so app.js owns run creation).
4. **app.js**: `startEnvironmentRun(env)` — POST `/device-runtime/sessions` with requestedLevel from env/board; on `not_available`/`busy` open `#exec-fallback` dialog with `fallbackOptionsFor` options; chosen option either queues (`allowQueue: true` + poll `/device-runtime/sessions/:id`) or creates QA run with the downgraded level recorded (env executionLevelRequested); queue panel renders on SSE `execution_facts`/poll: position via `describeQueue`, Cancel → POST cancel.
5. **deviceDrawer.js**: saved rows gain availability dot + max-level badge (from board fetch); Run button calls `onRunEnvironment` (new option) instead of only setting default.
6. **styles.css**: `.avail-dot` (ok=green/busy=amber/offline=gray), `#exec-fallback` option list, queue panel, responsive at 1280/768.
7. **Tests**: `public/deviceRuntimeUi.test.js` — fallback resolution (no real provider → no REAL option; BUSY → queue first; SIMULATED always), availability mapping, lastRunByEnv join, describeQueue positions.

### Acceptance criteria (from original spec, unchanged)
- Environments table shows Execution Type / Availability / Last Tested / Last Result; no-real-provider combos show NOT EXECUTABLE (real) + offer Simulated.
- iPhone 16 Pro / iOS 18.3 / Safari + Run Test, no real provider → fallback dialog; Simulated choice runs a labeled-SIMULATED run end-to-end.
- Busy device → queue panel with position + Cancel; auto-start on release.
- Bulk runs respect per-device availability; busy devices queue, not fail.
- Test Cases one-click + Bulk wizard still work, results show execution level.
- Layouts hold at 1280px and 768px; existing sections unchanged.
- npm test green + new unit tests.

### Edge cases
- Zero available devices → friendly empty state.
- Queue position changes live (poll or SSE).
- Browser closed mid-queue → session persists server-side; panel resumes on return.
