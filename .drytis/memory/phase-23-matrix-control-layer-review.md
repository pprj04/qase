# Phase 23 · Device Matrix control layer — review (2026-09-29)

Verdict: PASS with 2 WARNs (see ticket #13617).

## Architecture (verified in code)
- One-click Run (app.js startEnvironmentRun ~L663) does NOT pre-create a device session; it calls createQaRun and lets the run engine claim the session via agent.js runTurn → manager.selectForRun (~agent.js L563). This is why a Run click on an Available row never flips the row to Busy: the run sits IDLE awaiting a URL; only when a turn actually executes does selectForRun claim the slot. By design, matches "engine owns sessions".
- fallbackOptionsFor (public/deviceRuntimeUi.js) offers run_real ONLY when boardEntry.maximumLevel === 'REAL_DEVICE'; manager.maximumLevelFor requires attestPhysicalDevice() to return physical for REAL_DEVICE. With local-simulation as the only registered provider, every env is maximumLevel=SIMULATED → everything honestly labeled "Simulated".
- Device-runtime endpoints (/api/device-runtime/*) are registered AFTER the /api auth+CSRF middleware (server/app.js L216 vs L428+) — pre-login 401s observed by tester confirm enforcement.
- seedBoard (manager L331) pre-registers all environments; server/app.js L423 seeds from environments.list at startup.

## Known gaps (WARN, not fixed)
1. applyFallback 'queue' branch (app.js ~L707) reserves a queued device session with no linkedRunId and no QA run. On release, manager.completeSession auto-starts the SESSION (status flip only) — no run is ever created or driven from that queued session. "Queue → run executes end-to-end" is not wired; only the manager-level queue mechanics are tested.
2. Repeated Run clicks create multiple IDLE runs for the same env with no guard/warning (tester observed 3 duplicate runs). Device is also never claimed while runs sit idle, so the Busy→fallback dialog path is very hard to reach in the UI (needs an actively executing run on the same env).

## Test state
- npm test: 725 tests, 716 pass, 9 skipped, 0 fail (matches ticket claim).
- public/deviceRuntimeUi.test.js: 11 tests green.
