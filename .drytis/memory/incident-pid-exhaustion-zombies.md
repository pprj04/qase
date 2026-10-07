# PID exhaustion recurrence (2026-10-06, QA matrix Phase 1 session)

Same root cause as `incident-pid-exhaustion-zombies.md`: PID 1 never reaps orphans;
anything that spawns browser processes (the qase-server 5-min browser probes AND the
test suite's browser-launching tests) leaks zombies to RLIMIT_NPROC=7684, then every
fork fails. Confirmed today: full `node --test server/*.test.js` runs leak ~3,700+
zombies per run; qase-server's periodic probes leak slowly over hours.

Practical guidance:
- Full-suite runs are environmentally unreliable in this container until PID 1 reaps.
  Verify touched areas with targeted `node --test <files>` (those pass) instead of
  repeatedly re-running the full suite — each attempt crashes the container into fork
  exhaustion and forces a restart_container (~3-5 min each).
- After each restart, WebKit libs are gone again: `sudo npx playwright install-deps
  webkit` then verify with a webkit launch, or ~4 server tests fail for env reasons.
- Container restart is the ONLY zombie recovery (kill -9 on zombies does nothing —
  parent is PID 1).
- Also found this session: server/postgres/runRepository.js had an unresolved
  teammate merge conflict (scope_selection vs environment/matrix columns) left in the
  working tree; resolved as the union of both sides (39/41 params; scope_selection
  + environment_id/matrix_run_id coexist).
