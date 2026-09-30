# Phase 16 · Device Matrix as control layer: availability, queue, fallback UI

## Goal
The Device Matrix (drawer + admin dialog) becomes the control layer for real-device execution: per-environment availability (AVAILABLE/BUSY/OFFLINE), execution type, last tested/last result columns; device queue with position + auto-start; explicit fallback choice — never silent downgrade. One-click [Run Test] runs the full auto-flow (find device → session → permissions → open app → execute → evidence → logs → release).

## Backend
- `server/deviceRuntime/availability.js` — provider-reported device states aggregated per catalog env: AVAILABLE / BUSY / OFFLINE / NOT EXECUTABLE (no provider can ever run it). Local-only: everything NOT EXECUTABLE-for-real, AVAILABLE-simulated. BrowserStack connected: real-device pool availability. Cached (30s TTL) + `GET /api/devices/availability`.
- `server/deviceRuntime/queue.js` — in-process queue (both stores; DB-backed optional later): entries {id, envId, testCaseId?, requestedLevel, position, status queued|running|cancelled, autoStart}. Real-device slots exhausted → enqueue not fail. Events: position changes, start, timeout. `GET /api/device-queue`, `POST /api/device-queue` (enqueue), `DELETE /api/device-queue/:id` (cancel). Auto-start when provider frees a slot.
- Last tested/last result: derived from runs' deviceSession stamps — `GET /api/environments/:id/executions` (summary only).

## UI
- deviceDrawer saved-env rows + deviceMatrixView environments table: columns Execution Type (REAL DEVICE/VIRTUALIZED/SIMULATED chip) + Status dot (● Available/● Busy/● Offline/● Not executable) + Last Tested + Last Result.
- Drawer env detail: permissions scenario picker (camera/mic/notifications/location: Allow/Deny/Ask) + orientation picker (Portrait/Landscape) + [Run Test] one-click button. On click with requestedLevel real: auto-flow; if unavailable → fallback dialog: "Real device unavailable" with [Queue Real Device] / [Run Virtualized] / [Run Simulated] / [Cancel] — explicit choice only.
- Queue panel (drawer section): entries with Device/OS/Browser, position, "waiting"/estimated, [Cancel].
- Bulk runs wizard step 2 gains per-device requestedLevel; [Run N Tests] manages availability; busy devices auto-queue.
- Run screen: deviceSession chip (level + verified + as-executed env) in run env block; report.md/pdf gains "Execution: REAL DEVICE (verified) — iPhone 16 Pro · iOS 18.3 · Safari" section; artifacts list shows stamped evidence.

## Acceptance criteria (running app)
- [ ] Local (no BrowserStack creds): iPhone 16 Pro env shows SIMULATED + "Not executable as real device" status; selecting it + Run → run starts labeled SIMULATED with explicit note, or user picks fallback option — UI never implies real
- [ ] With creds: iPhone 16 Pro env shows REAL DEVICE + ● Available (or Busy); busy → [Run Test] offers queue; queue entry shows position; freeing auto-starts run; cancel works
- [ ] Fallback dialog shows all three options; choosing Virtualized runs and labels VIRTUALIZED
- [ ] Matrix columns render for 100+ envs without layout break; filterable by execution type and availability
- [ ] Bulk run across 6 mixed envs queues busy real devices, runs available ones, labels each result honestly
- [ ] Report/PDF show execution level + as-executed environment on every stamped run
- [ ] Existing UI (Test Cases, Agent Log, Browser Preview, Findings, Report, SQA, Founder) unchanged in function

## Edge cases
- Queue entry for env that becomes permanently offline → entry marked failed with reason, user notified
- Concurrent bulk run + single run competing for last free device → queue serializes
- Page reload mid-queue → queue state server-side, panel rehydrates
- Stale availability cache (device freed 5s ago) → run start re-checks availability authoritatively

## Tests
Unit: availability aggregation, queue ordering/auto-start/cancel, fallback resolution matrix. Integration: queue→run lifecycle with fake provider. Browser: drawer columns, fallback dialog, queue panel flows.
