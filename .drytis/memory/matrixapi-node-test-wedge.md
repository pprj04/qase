# matrixApi.test.js cannot run as one node --test file in this container

Symptom: file-level 'Promise resolution is still pending but the event loop has
already resolved' after ~2 tests; individual tests take 25s+ on first run in a
fresh container, later get faster.

Cause (environmental, not a code defect): each startApp() composition mounts
the REAL app (SSE heartbeats, matrix orchestrator polling). node:test runs
tests in child processes; the combination leaks long-lived handles + zombie
children under the container's non-reaping PID 1, tripping the pending-promise
wedge and PID exhaustion ('fork/exec /bin/bash: resource temporarily
unavailable', RLIMIT_NPROC 7684).

Verification protocol that WORKS (all 7 tests verified individually PASS):
  node --test --test-name-pattern='<pattern>' server/matrixApi.test.js
grouped runs: 'deselection|rejects invalid|unknown matrix run', 'cancel|restart',
'refuse terminal-success', 'honest items over HTTP'.
The evidence-per-item route check lives as a STANDALONE script:
server/matrixEvidence.standalone.test.mjs (7/7 checks, ~20-40s).
Checklist: .drytis/matrixApi-checklist.md.

Also: container restarts wipe /tmp AND ~/.cache/ms-playwright stays but apt
deps for webkit need re-running /project-config/setup.sh (memory:
container-restart-reinstalls). localhost:5173 login: POST /api/auth/login
tester@qase.dev / token-count-test-2026; CSRF cookie qase_csrf → header
x-csrf-token for POST /api/qa-matrix-runs.
