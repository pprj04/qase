# CRITICAL: container restart wipes uncommitted work in this project

Observed 2026-08-27 ~21:52 UTC: `restart_container` reset /workspace to the last
pushed commit (C3, 2a22a74). ALL uncommitted modifications and untracked files
were destroyed: the OpenAPI guide-audit patch (openapiDocument.js, pulseV2Router.js,
pulseProjection.js + tests), the C4 BrowserStack workstream (secretStore.js,
browserstackAgentRuntime.js, browserstackCaps.js, config.js/agent.js/index.js/app.js/
index.html/styles.css changes), QASE-API-DEV-HANDOFF/, QASE-API-HANDOFF/, tests-new/,
test-results/, and .drytis notes/specs created after the last checkpoint.

Countermeasures going forward:
1. NEVER leave significant work uncommitted across a restart — publish or at
   minimum commit locally before restart_container.
2. The C3 baseline's /openapi.json is intact and serving (32 GETs, 3.1.0,
   validator 0 violations). Production qase.drytis.com runs C2 (older doc,
   same shape).
3. QASE_API_TOKEN in /workspace/.env is instance-wide full read/write; no
   read-only token exists (Pulse guide gap, options A/B/C in QASE-API-HANDOFF/README.md).

Also lost: the b1-token-gate-ux-fix spec (was 5/5 PASS) and the detailed
openapi-handoff-audit-aug27 note. Shared-run verification results from
2026-08-27 (tester 3/3 PASS; run 7c15ca8f deleted from stores; gate = B1
design, pre-C3) are recorded here as the only surviving copy.
