# Phase 5 — Black-box re-verification + verdict

## Goal
Prove externally that both blockers are closed: re-run the independent harness with new integration-surface discovery checks, confirm 32/32 + new checks PASS, and re-issue the handoff verdict.

## Files to change
- `/workspace/handoff-test/golden-flow-runner.mjs` (extend)
- `/workspace/.drytis/notes/handoff-readiness-*.md` (new dated note)

## Work
1. Extend the black-box harness with new checks:
   - Integration surface present in `/openapi.json` (15 ops, methods, success codes incl. 202/201/409)
   - hmacAuth scheme documented with signing format + error codes
   - Live HMAC calls still behave identically (whoami 200, bad-sig 401, replayed nonce 401, admin op 403) — must be unchanged by the spec work
   - Schema validation of `GET /api/v2/projects` with `workspace_id: null` (flow.4 fix)
2. Re-run `golden-flow-runner.mjs` (target 32/32 + new checks all PASS) and `qase-external-demo.mjs`.
3. Re-run `npm run test:openapi`, the pulse-openapi suites, and the parity test.
4. Re-verify serving: `GET /openapi.json` returns the integration paths (spot-check via curl).
5. Write the new dated handoff note recording PASS/FAIL per checklist item and the verdict.
6. Ensure all work is committed (protected-file gate) and the board ticket moves to Done.

## Acceptance criteria (true in the running app)
- [ ] `/openapi.json` (live, from a cold external fetch) contains the 15 integration ops + hmacAuth scheme
- [ ] Black-box harness reports all checks PASS including null-workspace_id schema validation
- [ ] Demo client still runs green with zero behavior change
- [ ] test:openapi + openapi unit/api/parity tests all pass
- [ ] Handoff checklist re-issued: all 9 items PASS → verdict **READY FOR EXTERNAL INTEGRATION**

## Tests
- The extended black-box harness IS the test; run it twice (fresh key nonce each run — nonces are single-use).

## Edge cases
- The handoff test key `ext-handoff-test` (workspace handoff-ws) is already registered; reuse it, don't re-register
- Nonce single-use means each harness run needs fresh nonces — the client already generates per-request
- If the board API is still down, record the Done state in the note and move the ticket when it recovers
