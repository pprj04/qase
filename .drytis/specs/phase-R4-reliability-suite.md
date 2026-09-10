# Phase R4 — Reliability failure-injection suite (P0)

New tests under tests-real/ (node:test, injectable fakes per existing patterns — see browserstackTest.js fetchImpl/wsFactory, mission-governor.test.js). All deterministic; no real LLM.

## Suite: tests-real/reliability-lifecycle.test.js
1. **Integration stop on queued** → mission `cancelled`, queue entry gone, simulated boot (`requeuePersistedMissions` on a fresh module instance / store reload) does NOT re-execute. Also created→cancelled, terminal→idempotent.
2. **Governor onTimeout parity** → inject wall-clock-expired mission; assert finalizeTurnLimitedRun ran, evidence collected, final `failed/execution_timeout`.
3. **Hung runtime kick (G7)** → session with pendingRuntimeKick; stuck detector must NOT finalize; late resolve must not re-open terminal mission.
4. **Honesty fix (G12)** → session with error message in `messages`; failureReason carries it.

## Suite: tests-real/reliability-leaks.test.js
5. **awaiting_input expiry** → fake clock past expiry → session interrupted, browser closed (fake bridge records close), mission terminal honest.
6. **prune closes browser + removes workspace** → fake session + tmp workspace dir + fake bridge; after prune, dir gone, bridge.closed true, live map empty.
7. **Workspace cleanup on dispose** → dispose path removes dir.
8. **Boot orphan sweep** → spawn a fake `sh -c` process with `ms-playwright` in cmdline (or test the matcher function directly against cmdline strings); assert match excludes non-playwright processes.

## Suite: tests-real/reliability-persistence.test.js
9. **SIGKILL mid-write** → child process loops atomicWrite on a tmp store; SIGKILL it; parent loads file — either valid JSON or quarantined `.corrupt-*`, NEVER half-written JSON; repeat ×20.
10. **Corrupt-load visibility** → corrupt a tmp store, load, assert diagnostics fields (lastCorruptLoadAt, backup path) and empty-but-flagged behavior.
11. **Write-failure counter** → inject failing write (tmp dir chmod/EACCES or stubbed fs) → counter increments, surfaced in diagnostics payload.
12. **Boot requeue/adoption sim** → seed missions.json variants (queued → requeued; running+settled session → adopted honest finalize; running+gone session → interrupted) against boot routines with fake getSession.

## Suite: tests-real/reliability-webhooks.test.js
13. **Event-name fix (G4)** → updateMission to failed triggers the failed-webhook listener (fake bus capture).

## Port: tests-real/reliability-browser-crash.test.js
14. Port `.drytis/browser-recovery-e2e-runner.js` (currently `passed:false`, finalStatus `running`) into tests-real with a terminal-state assertion: kill chromium mid-mission → session settles done/error/interrupted AND mission reaches a terminal state (the old runner never asserted the mission side). Use the /demo target, headless, short budget; skip gracefully (not fail) if no local chromium is installed.

## Wiring
Add all suites to scripts/run-tests.mjs category list + package.json scripts (`test:reliability`). Suites must be offline-safe except the browser-crash port (guarded skip).

**Acceptance**: `npm run test:reliability` green locally; every numbered case above has an asserting test (no smoke-only tests); existing suites unaffected.
