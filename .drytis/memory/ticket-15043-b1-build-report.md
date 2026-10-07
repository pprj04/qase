# Phase B1 · Start QA wired to real multi-browser execution — Ticket #15043

## Status: BUILD COMPLETE — verification PASS with 4 WARN (deferred to B2/B3), reviewed by reviewer + infra_verifier

## What was built
- Server: `matrixService.js` — MATRIX_ITEM_STATUSES + QUEUED/CANCELLED; `cancel()`; `create()` targetUrl-only mode carrying kickoffText/selectedTests/securityAuthorization/scopeSelection; `_setStatus` accepts `cancelled`.
- `matrixOrchestrator.js` — `cancel(matrixRunId)` (QUEUED/PENDING→CANCELLED, in-flight keep honest outcome, `matrix_run_cancelled` emit), `retryItem` bounded MAX_ITEM_RETRIES=2 clearing prior verdict/artifacts, `cancelledRuns` set, `statusCounts` + QUEUED/CANCELLED, `resumeRecovery` leaves cancelled runs cancelled.
- `matrixApi.js` — `POST /api/matrix-runs/:id/cancel`, `POST /api/matrix-runs/:id/items/:itemId/retry`.
- `server/app.js` — `POST /api/qa-matrix-runs` QA-start wrapper (one run, one item per selected configuration envId); `sendTask` sends `kickoffText ?? targetUrl`; `startSession` forwards QA-start context.
- `public/app.js` — QA submit handler POSTs `/qa-matrix-runs` with full `configurationEnvIds`; old `slice(0,1)` + hardcoded `engine:'chromium'` path removed; `waitForFirstMatrixSession(matrixRunId, 15s)` polls `GET /api/matrix-runs/:id` for first RUNNING item with sessionId → `selectSession`.
- Tests: `server/matrixService.queued.test.js` (5), updated matrixService/matrixOrchestrator tests.

## Test evidence (final runs on fresh container)
- matrixService.test.js 16/16, matrixOrchestrator.test.js 10/10, matrixApi.test.js 5/5, matrixService.queued.test.js 5/5 → 36 pass / 0 fail.
- Full `npm test` (150 files) cannot run on this box: fork resource contention (spawn EAGAIN) — same environmental issue as previous sessions. Targeted suite only.
- Box note: intermittent `fork: retry` / JSON 502 on run_bash; waiting 60-180s and retrying the same command resolves it. Container replaced at least once mid-session (10-min idle).

## Verification
- infra_verifier: RESULT PASS (0 failures). 1 WARN: `QASE_BROWSER_ALLOWED_PRIVATE_HOSTS` (env key id 50925) contains stale preview host qase-2-1-jywqe4, omits current qase-2-1-cvtryq → agent blocked from navigating its own /demo/security fixtures. TODO: update via update_environment_key to a {{DOMAIN}}-templated value.
- reviewer: all six core ACs PASS. Security pass clean (no injection/XSS/auth bypass; client `ownerUserId` overridden server-side at app.js:912).

## Reviewer WARNs — explicitly DEFERRED (B2/B3 scope, not B1 defects)
1. SSE `matrix_item` frontend consumer absent — deliberate deviation documented in code: SSE stream endpoint is session-scoped (requireSession 404s for matrix-run ids); polling-only. Full results board = B2 (#15044).
2. `cancelItem()` (single queued item) — phase-3 spec referenced; B1 AC only requires run-level cancel. Defer to B3/B2 ticket scope decision.
3. No HTTP-level tests for /cancel, /retry, /api/qa-matrix-runs — ADD to B2 or B3 test list.
4. TEST ON unification (`selectedEnvironmentForRun` still reads legacy `activeTestEnvStore`) — device value effectively unused by /qa-matrix-runs body. Defer decision to B2.

## Cosmetic notes
- Toast count uses pre-dedup client list; server dedupes duplicate envIds (correct behavior).
- Stray untracked file `&1` in repo root (shell artifact) — DO NOT commit; add to cleanup before publish.

## Infra gate state (passed 2026-10-06)
- procmgr: all 7 services RUNNING (qase-server = service-bg-service-4182, port 5173, `exec node server/index.js`).
- Stale registered process bug: procmgr can hold a dead pid (643) with RUNNING status after container swap — `procmgr restart service-bg-service-4182` fixes it. If curl 5173 returns 000/connection refused but procmgr says RUNNING, restart the service.
- Preview https://qase-2-1-cvtryq.drytis.dev/ → 200, serves Qase app; Caddy root proxy → 5173 correct.
- Auth: login POST /api/auth/login with cred.json tester@qase.dev works; /api/qa-configurations then returns full catalog (verified live).

## Next
B2 (#15044): per-browser results board, explicit status vocabulary UI, SSE/polling results view — pick up reviewer WARNs 1–4 there.
