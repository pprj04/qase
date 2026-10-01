# Phase 4 infra verification — test cases + multi-env (round 1, 2026-09-29)

Scope: server/testCaseService.js, server/postgres/testCaseRepository.js, migration 017_test_cases.sql, server/testCaseApi.js, run linkage (testCaseId on sessions), UI public/testCaseView.js + public/bulkRunView.js.

## Result: FAIL (1) — backend complete and live, UI not delivered

- Backend all present and verified live (tester@qase.dev): GET /api/test-cases 200 (auth-gated 401 unauth), POST 201 (TC-0001), GET :id 200, PATCH 200, DELETE 204 soft-delete (list back to total 0; deleted:true persists in .qase/test-cases.json), invalid testCaseId type → 422. Server-generated TC-XXXX numbering confirmed.
- Wiring: app.js:28,412-418 (createTestCaseRoutes when services.testCases), serviceFactory.js:90,145. Run linkage: app.js resolveTestCaseForRun (77-88) + session create 599-605; store.js:167,199 testCaseId; runRepository.js:460,643,659 test_case_id column.
- Migration 017: tenant-scoped test_cases + qa_runs.test_case_id text + RLS — confined to migrations dir. NEW-migration style (no amend of 016) — the Phase-2 checksum warning was heeded.
- **FAIL: UI absent** — public/testCaseView.js and public/bulkRunView.js do not exist; zero testCase/bulkRun references in public/app.js and public/index.html. Spec phase-19-testcases-multienv.md checklist item "Test-case UI: list/create/edit/assign + run prefill" (line 72) unchecked. Same backend-first pattern as Phase 3 round 1.

## Notes
- Task description said `POST /api/test-cases/:id/environments`; actual (spec-compliant) implementation handles environment assignment via PATCH /api/test-cases/:caseNumber — spec line 33 agrees. No /:id/environments route exists; not a defect per spec.
- Standard checks all clean: env parity 20/20, no dev processes, preview 200 real app, Caddy→5173, setup script unchanged/valid, no raw schema SQL outside migrations, no hardcoded secrets (drytis.dev greps are the meeting-host allowlist, documented).
- .env.example standing WARN persists (placeholder-only template, no backend env_key).
- Tests exist: server/testCaseApi.test.js, server/testCaseService.test.js (not run by me — reviewer's job).
