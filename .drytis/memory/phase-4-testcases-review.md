# Phase 4 review — test cases multi-env (spec `.drytis/specs/phase-19-testcases-multienv.md`)

Reviewed 2026-09-29. Note: task prompt called the spec "phase-19-testcase-multienv.md"; actual file is `phase-19-testcases-multienv.md`.

## Critical findings

1. **Postgres mode is broken — facade/repository contract mismatch.**
   `createTestCaseService` (server/testCaseService.js:231+) calls `backend.list(filters)`, `backend.get(caseNumber)`, `backend.create(input)`, `backend.update(caseNumber, patch)`, `backend.remove(caseNumber)` — single leading arg.
   `createPostgresTestCaseRepository` (server/postgres/testCaseRepository.js) expects `(tenant, filters)`, `(tenant, caseNumber)`, etc., with `requireTenant(tenant ?? tenantContext)` — but the facade NEVER passes tenant and the factory constructs the repo with `{ tenantContext }` as an *option the repo ignores for the first positional arg*. Proven with a fake pool: every facade call over the postgres repo throws "A tenant context (organizationId, projectId) is required."
   Contrast: environmentService facade passes `withTenant()` explicitly as first arg (environmentService.js:302–321). Fix: mirror that pattern (facade takes `tenantContext` and prepends it), or repo should default the first arg to its injected tenantContext.
2. **`server/postgres/testCaseRepository.test.js` does not exist** (spec requires SQL-shape/RLS/patch tests). runRepository.test.js only re-indexed param assertions for the new column — no test_case round-trip test. That's why #1 wasn't caught: zero test coverage of the postgres path.
3. **UI entirely missing:** no public/testCaseView.js, no bulkRunView.js, no testCaseView.test.js, zero wiring in app.js/index.html/styles.css (grep: 0 matches). Spec criterion "Test-case UI: list/create/edit/assign + run prefill" unmet. (bulkRunView is arguably Phase 5 #13440, but testCaseView is squarely Phase 4.)
4. **Report-header case title not implemented:** spec says "case title rendered in report header" — grep for testCase/test_case in report.js/reportPdf.js/agent.js → zero hits.

## What passed (local mode, verified live authenticated)

- Migration 017: test_cases + qa_runs.test_case_id + RLS policy, new file (no amended applied migration). migrations.test.js updated to 17 versions.
- Local backend: atomic write, lazy load, TC-XXXX numbering continues across restarts and skips nothing (soft-deleted included in max), soft delete keeps record on disk.
- Live probes (tester@qase.dev, CSRF ok): POST unknown env → 422 QASE_TESTCASE_INVALID; create → 201 TC-0002; PATCH addEnvironmentIds unknown → 422; POST /api/sessions unassigned env → 422 "not assigned to TC-0002"; unknown case → 422; no testCaseId → 201 (backward compat); DELETE → 204 then GET 404. GET /api/test-cases sends Cache-Control: no-store (Phase-3 lesson applied).
- Full suite: 646 tests / 637 pass / 0 fail / 9 skipped.
- Security: parameterized SQL only; routes under /api auth (401 unauth) + CSRF (403 without token).

## Warnings

- Facade `update` never normalizes patch fields before repo.update → in (fixed) postgres mode a `title: ""` PATCH would hit the DB CHECK → 500 instead of 422 (local backend normalizes merged input, so local is safe).
- Only plain POST /api/sessions accepts testCaseId; /api/sqa/sessions and /api/founder... don't (spec said "session-create endpoints", plural).
- testCaseSnapshot stored/returned local only; postgres hydration has testCaseId but no snapshot (spec sanctioned this, but report-header rendering that would consume it is absent).
- Local backend.update does not re-validate removeEnvironmentIds (removing unknown ids is a no-op — benign).
