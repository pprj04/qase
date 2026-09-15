# #10638 Fix agent runs getting stuck

## Problem
The application awaits the SDK stream without a progress deadline. Provider activity (including reasoning) can keep its own inactivity timer alive indefinitely. The screenshot alone does not establish which request stalled. Local session storage also has pre-existing filesystem corruption; preserve it and report that limitation.

## Acceptance criteria
- [x] Bound silent streams and reasoning-only turns independently of provider network activity.
- [x] Abort stalled work and retry only after the previous stream has actually closed; never overlap browser actions.
- [x] Preserve user Stop, pending questions, final report completion, and bounded retry exhaustion.
- [x] Cover stalled, reasoning-only, uncooperative, and healthy streams with deterministic tests.
- [x] Run regression suite, live preview health, infrastructure review, code review, and browser verification.
- [x] Rework (engineer review): provide a dedicated, reproducible way to simulate the unresponsive-runtime failure and observe the runtime-reuse block through the QA interface.

## Rework: dedicated reproduction through the QA interface (engineer review)

The engineer could not reproduce the failure ("no dedicated way to simulate a
runtime that remains open beyond the 5-second shutdown threshold"), so neither
the actionable error nor the runtime-reuse block could be verified.

- [x] `server/agentFaultSimulation.js` — new module: `/qase-test` chat command with
      two subcommands (`unresponsive-runtime`, `runtime-reuse-block`). Applies the
      exact guarded faults through the same live-record path a real incident
      takes (`record.unresponsive`), no model call, no browser.
- [x] `server/app.js` — message route recognizes the command before any turn
      starts and returns `{ok, simulation, message}`; unknown subcommand → 400
      with usage.
- [x] `server/agentFaultSimulation.test.js` — 6 unit tests incl. the real
      `agent.js` reuse block rejecting a follow-up turn on the quarantined
      runtime.
- [x] `server/app.test.js` — HTTP-surface test: full flow = apply fault → run
      shows actionable error + status `error` → follow-up message rejected 500
      "could not shut down safely. Start a new run" → unknown subcommand 400.
- [x] Full suite green: 505 tests, 496 pass, 0 fail, 9 skipped.

## Verification
Full suite: 487 tests, 478 passed, 9 skipped, 0 failed with local networking permissions. Focused guard tests cover silence, endless reasoning, healthy progress, failed tool loops, Stop, uncooperative streams, and finalization. Agent integration tests cover retry/report completion, runtime quarantine, and surviving executor rejection. Code reviewer passed round 2. Infrastructure checks passed after production-command preview service reload: procmgr green, Caddy root to 5173, root and local health HTTP 200. Browser tester verified live login and controlled Stop request/SSE behavior after reload. No real provider stall or original screenshot session was reproduced/recovered. Existing filesystem corruption remains untouched and is a separate limitation.

Rework verification: unit tests 6/6, app integration test passing, full suite 505/496/0/9. Deployed to preview and production with the `/qase-test` command live.
