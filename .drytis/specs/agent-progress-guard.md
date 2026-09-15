# #10638 Fix agent runs getting stuck

## Problem
The application awaits the SDK stream without a progress deadline. Provider activity (including reasoning) can keep its own inactivity timer alive indefinitely. The screenshot alone does not establish which request stalled. Local session storage also has pre-existing filesystem corruption; preserve it and report that limitation.

## Acceptance criteria
- [x] Bound silent streams and reasoning-only turns independently of provider network activity.
- [x] Abort stalled work and retry only after the previous stream has actually closed; never overlap browser actions.
- [x] Preserve user Stop, pending questions, final report completion, and bounded retry exhaustion.
- [x] Cover stalled, reasoning-only, healthy, cancellation, and uncooperative streams with deterministic tests.
- [x] Run regression suite, live preview health, infrastructure review, code review, and browser verification.

Use a two-minute silence deadline and five-minute no-action deadline. Successful tool results reset action progress. No new environment variables or dependencies.

## Verification
Full suite: 487 tests, 478 passed, 9 skipped, 0 failed with local networking permissions. Focused guard tests cover silence, endless reasoning, healthy progress, failed tool loops, Stop, uncooperative streams, and finalization. Agent integration tests cover retry/report completion, runtime quarantine, and surviving executor rejection. Code reviewer passed round 2. Infrastructure checks passed after production-command preview service reload: procmgr green, Caddy root to 5173, root and local health HTTP 200. Browser tester verified live login and controlled Stop request/SSE behavior after reload. No real provider stall or original screenshot session was reproduced/recovered. Existing filesystem corruption remains untouched and is a separate limitation.
