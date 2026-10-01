# Phase 4 security execution — E2E verification results & postmortem

## Final E2E results (2026-09-29) — BOTH contract halves verified live

**Run 4 — vulnerable fixture (5c5aa109), status done, verdict FAIL:**
6 findings, all correct severity & category:
- critical/authorization: IDOR — viewer Bob opens Alice's records r1/r2 by direct URL
- high/input validation: XSS executes (alert fired from injected feedback message)
- high/security_sql_injection: OR-tautology SKU returns all products
- medium/authentication: user enumeration via "No account exists with that email"
- medium/input validation: accepts empty/negative/21-digit/4k-char inputs
- medium/security_sql_injection: raw SqlError leak with query fragment
All 4 securityOutcomes = fail with concrete differential evidence. MITM/DoS listed in Not covered with unavailable reason. Agent asked for credentials via ask_question (no guessing); passwords went through the vault (/api/sessions/:id/credentials), never through model tool calls.

**Run 5 — safe fixture (719519aa), status done, verdict PASS, 0 findings:**
- authentication pass (generic errors, session invalidated on logout)
- authorization pass (403 for Bob on r1/r2)
- input validation pass (400s for all invalid inputs)
- sql_injection **not_tested with reason** — probes showed no differential; absence-of-evidence honesty contract worked as designed.
NO false failures on the safe variant.

## Postmortem: two wedged-run defects found & fixed during E2E

1. **browser_snapshot / browser_diagnostics hang with no timeout.** MCP round-trips can wedge forever (observed 3×: snapshot twice, diagnostics once — diagnostics hung after the XSS probe killed the renderer; page.title() never returns). Stop could NOT recover: /stop aborts the model stream, but an awaited tool promise still blocks the stream loop. FIX: `withBrowserOperationTimeout(work, timeoutMs, opName)` in browserBridge.js bounds service.snapshot and service.getDiagnostics; env QASE_SNAPSHOT_TIMEOUT_MS (floor 5s, default 30s). Timeout → retryable error telling the agent to report not-tested-with-reason.

2. **Self-inflicted crash in the first timeout fix:** `Promise.resolve().then(work)` where `work` was already a promise — .then silently passes undefined through, so snapshot returned undefined → SDK crashed with "Cannot read properties of undefined (reading 'length')" → run errored. Fixed: helper accepts thunk OR promise (`typeof work === 'function' ? then(work) : resolve(work)`). Tests in browserSnapshotTimeout.test.js pin this.

## Notes
- E2E auth via API: same-origin check needs Origin header matching public Host; login then CSRF token from cookie (X-CSRF-Token header) for POSTs.
- Fixtures live at /demo/security/{safe,vulnerable}/{auth,authz,input,sqli}. Allowlist entry QASE_BROWSER_ALLOWED_PRIVATE_HOSTS contains this preview host so the agent can reach them (private-network guard still blocks other private IPs — verified).
- Agent on interrupt/auto-resume works but a mid-run container replacement loses the browser page; runs auto-resume via runResume (max 3).
- Full suite: 620 tests, 612 pass, 8 skipped (pg-gated).