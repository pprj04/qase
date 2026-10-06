# RT2 · Runtime health checks & honest availability board

## Goal
The Device Matrix reflects live, probed environment status — not static config. Before execution, an automatic health gate runs real checks and blocks execution with an exact reason when a check fails.

## Work
1. **Health checker** (new `server/environmentHealth.js`): per environment, run real probes: engine/binary launchable (real launch, short-lived), network reachable, viewport/emulation apply-able, mic capability probe (where declared), execution service connected. Results: each check {name, status: PASS|FAIL|SKIPPED, detail}. Overall gate verdict READY|BLOCKED(reason).
2. **Board states** (`deviceRuntime/manager.js`, `deviceRuntimeUi.js`): the requested vocabulary — AVAILABLE / PREPARING / RUNNING / BUSY / OFFLINE / ERROR / UNAVAILABLE — computed from: provider capabilities (RT1), live probe results (this phase), and active sessions (queue length → BUSY). The board refreshes from probes on an interval, not just on boot.
3. **Pre-execution gate** (`matrixOrchestrator.js` `executeItem` + `app.js` session-start path): before launching, run the health gate; FAIL → item marked UNAVAILABLE (or ERROR for infrastructure faults) with the failing check's exact reason; never launched, never Passed.
4. **UI labels** (existing columns/rows only): Availability cell shows the probed status + tooltip reason; no structural change to the Environments table or Device Matrix.

## Tests
- Gate unit tests: failing launch probe → UNAVAILABLE + reason; healthy → READY and proceeds.
- Board state mapping tests (probe result × session state → status).
- Orchestrator: unhealthy item never calls startSession; recorded reason matches the probe detail.

## Edge cases
- Probe timeout → treated as FAIL with 'probe timed out', not as pass.
- Concurrent probe + running session → status RUNNING wins, probe skipped.
- Flapping binaries → cached TTL with last-seen timestamp; status shows last-checked time.

## Acceptance criteria (running app)
- [ ] An environment whose browser cannot launch shows Unavailable (or Error) with the exact failing check in the UI, and a run attempt records that reason — it never starts.
- [ ] A healthy environment proceeds from validation to launch without any manual step or prompt.
- [ ] The availability status shown in the Environments list changes within one refresh interval after the underlying capability changes (e.g., binary removed).
