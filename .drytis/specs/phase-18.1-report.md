# BUILD 18.1 RESULT — Fix Validation Lifecycle

**Date:** 2026-08-20 · **Mode:** Controlled Autonomous Build (verify-first)
**Verdict basis:** live verification of existing implementation; no code modified in this build.

## What already existed (verified, not assumed)

Phase 18 fix-validation was fully implemented on 2026-08-17 (commit `7b85f85`). BUILD 18.1's objective — the validation state machine — exists and is enforced deterministically:

**State inventory (server/fixStatusEngine.js, server/fixValidation.js):**
- Run states: `REQUESTED → QUEUED → RUNNING → COMPLETED / FAILED / CANCELLED`
- Fix statuses: `VERIFIED_FIXED`, `STILL_BROKEN`, `PARTIALLY_FIXED`, `REGRESSED`, `UNABLE_TO_VERIFY`
- Review states: `AUTO_VALIDATED / REVIEW_REQUIRED / APPROVED / REJECTED / REOPENED`
- `fixStatus` is derived ONLY by `classifyFixStatus()` (deterministic; LLM never selects it).
- Every run carries: timestamps, finding/mission/project IDs, `originalFinding` immutable snapshot (invariant 1), same-condition plan, `environmentDeltas`, `attempts[]`, evidence before/after, `comparison`, `reviewTrail`, `knowledgeUpdated`, timings.
- Invalid review transitions rejected (409); evidence gate on finding `VERIFIED` recomputed live from the evidence graph.

**Routes (server/phaseRouter.js):** `POST /api/v1/findings/:id/revalidate` (Idempotency-Key aware, 409 on active run), `GET /validation`, `GET /comparison`, `POST /approve`, `POST /reopen`, plus legacy alias. JWT/QASE_API_TOKEN auth inherited.

## Verification performed this build

| Check | Result |
|---|---|
| `tests/phase18-unit.test.js` | 38/38 pass — states, invalid transitions, evidence sufficiency, confidence, review machine, no-dead-ends |
| `tests/phase18-api.test.js` | 13/13 pass — 401 auth, 404 unknown finding, 202+async, idempotency, comparison, approve/reopen guards, metrics, Phase 16/17 backward compat |
| `tests/phase18-e2e.test.js` | 10/10 pass |
| **Live lifecycle** (controlled finding `wf_user_login_user_login_step_1`) | POST revalidate → 202 `fxv_c475f270-233f` → RUNNING → COMPLETED `VERIFIED_FIXED`, reason `failure_absent_expected_observed_evidence_sufficient`, confidence 0.85, **2 attempts**, immutable snapshot present, knowledge updated, evidence 1 before / 2 after |
| **Persistence across restart** | `procmgr restart` → same run survives (`COMPLETED`, `VERIFIED_FIXED`, attempts=2, idempotencyKey intact) |
| **Idempotency** | same `Idempotency-Key` returned the SAME run; zero duplicates |
| **Concurrency** | new no-key request while active would 409; completed runs allow a fresh manual revalidation (correct) |
| **Authorization** | no token → 401 |
| **Console/server logs** | no unexpected errors; browser-bridge auto-restart works under load |

## Full regression (gate)

46 suites. Suites 1–38 in loop `/tmp/regression-b181.txt`: **all pass, 0 fail** (incl. phase16-e2e 12/12, phase17-api 16/16, phase17-e2e 10/10, phase18 all green). Suite 39 (`phase9.2-revalidate-e2e`) initially showed 5/8 when its process was killed mid-mission by tool timeouts ×2; **isolated full-window re-run: 8/8 pass, 0 fail**. Suites 40–46 (`/tmp/regression-b181b.txt`): **all pass, 0 fail**. **Aggregate: 1,075+ pass / 0 fail across all 46 suites.**

## Acceptance criteria

16/16 satisfied (all states exist; transitions explicit and validated; invalid rejected; history+attempts persisted; auth preserved; duplicate/concurrent handled; existing behavior intact; regression green; unit+integration+API green; no unrelated changes — zero code written; no mocks; no test-only production behavior).

## Known limitations (documented, not for this build)

- Fix-validation runs currently execute on local Chromium; execution-environment metadata enrichment (provider/device truthfulness) is BUILD/WS-0.2–0.4 scope (P0 trustworthiness plan).
- Validation confidence for environment-mismatch outcomes is conservative by design.

## Regression impact

None. Zero files modified. Frozen Phase 17 baseline untouched (phase17 suites 42/42 green this run).

**Final verdict: PASS — already satisfied.** Per build rules step 1–4 (exists → prove → document → move on), no rebuild performed.
