# External handoff readiness — Phase 5 re-verification (2026-09-01, 20:35 UTC)

Re-run of the independent black-box harness after Phases 1–4 of the contract cleanup
(commits 08976a0, 1df036a, 1cf6a66, 53e0fa3). Harness: /workspace/handoff-test/ —
HTTP only, zero QASE-source imports, HMAC credential (keyId `ext-handoff-test`).

## Result: 37/37 black-box checks PASS

### Both blockers closed
1. **Nullability drift** — `GET /api/v2/projects` with `workspace_id: null` now validates
   against the live spec (`anyOf [string, null]`); flow.4 PASSES. All 12 component schemas
   declare nullable unions for projector-null fields; `Mission.correlation_id` and
   `FixValidationRun.partial_fix` declared.
2. **Integration surface in live spec** — `/openapi.json` (retitled "Qase API") now carries
   all 15 `/api/v1/integration/*` operations with per-op success codes (202/201/200/409 as
   documented), an `hmacAuth` securityScheme describing the full signing contract
   (canonical string, ±5min window, single-use nonces) and all six 401 error codes.
   Old GET-only claim and exclusion note removed.

### Checklist (re-issued)
| Item | Verdict |
|---|---|
| OpenAPI discoverable | PASS |
| Authentication documented | PASS (bearer + hmacAuth) |
| Dedicated integration credential | PASS |
| Successful API call | PASS |
| Response schema validated | PASS (incl. null workspace_id) |
| 401 behavior | PASS |
| 403 behavior | PASS |
| 4xx validation | PASS |
| External standalone client | PASS (demo client green) |

### Supporting suites
- `npm run test:openapi` — 47 ops, 0 violations (now lints POSTs too)
- `pulse-openapi-document` + `openapi-docs-parity` unit tests — 21/21
- `pulse-openapi-api` live suite — 13/13 (run with `QASE_BASE_URL=http://localhost:5173`;
  note the documented env-name collision — bare `--env-file` points QASE_BASE_URL at the LLM host)
- HMAC negatives re-verified live: bad_signature 401, unknown_key 401, replayed_nonce 401,
  admin_required 403, mission_not_found 404, invalid_max_turns 400

## VERDICT: 🟢 READY FOR EXTERNAL INTEGRATION

An independent developer can now open /openapi.json → understand both auth schemes →
find the integration endpoints → request credentials → call QASE → receive documented
responses → handle documented errors, without reading QASE source or asking the team.

Housekeeping: 4 phase commits unpushed at time of this note (user decides push).
