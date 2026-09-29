# Phase 4 review — round 2 (post-fix re-review), spec phase-19-testcases-multienv.md

Verdict: **PASS**. All five round-1 FAILs fixed:

1. **UI built**: public/testCaseView.js (list/search/create/edit/delete + env multi-select + run prefill via startRunForTestCase), public/bulkRunView.js (case×env pairs → sequential POST /sessions), 4 unit tests (public/testCaseView.test.js), wired in app.js (footer nav #open-test-cases/#open-bulk-run, dialogs #test-cases/#bulk-run in index.html, .tc-*/.bulk-* styles). Assets served 200.
2. **Tenant-arg mismatch fixed**: facade passes `withTenant()` as first backend arg (testCaseService.js:234–281); local backend signature changed to `(_tenant, …)`; serviceFactory passes tenantContext in both modes; repo methods default `tenant ?? tenantContext`. Proven by new postgres tests against fake pool.
3. **server/postgres/testCaseRepository.test.js exists** — 9 tests (facade-with-tenant, RLS set_config per connection, parameterized filters, TC numbering inside BEGIN→set_config→INSERT→COMMIT, update column whitelist + array UNION/EXCEPT merge, soft delete, facade normalization (empty-title → QASE_TESTCASE_INVALID, no UPDATE issued), rollback). All pass.
4. **Report header renders case title**: report.js:75–76 (markdown), reportPdf.js:69–71 (metadata row), fallback to testCaseId/—. No dedicated test (report.test.js doesn't exist; reportPdf.test.js has 0 testCase refs) — noted as minor.
5. **Facade update normalization**: normalizedPatch merges existing record through normalizeTestCaseInput before backend.update. Live: PATCH `{"title":"  "}` → 422.

Live probes (tester@qase.dev): create with env assignment 201 TC-0004; unassigned env on run → 422; plain session `{}` → 201 (backward compat); DELETE 204; unauth list 401; CSRF required on writes.

Tests: targeted 13/13 pass; `npm test` → 655 tests, 646 pass, 0 fail, 9 skipped (baseline + new).

Security: UI all textContent (innerHTML only to clear containers); calls via shared api() helper (single Content-Type, CSRF token); no hardcoded URLs/creds; postgres fully parameterized.

Remaining nits (WARN, non-blocking):
- Report case-title rendering untested.
- startRunForTestCase stores case on a DOM property of the env select (fragile coupling); cleared in qa start close (app.js:2626–2627).
- Bulk envMode option value is "none" with label "choose per case below" but pairsToRun only understands 'all' or a single envId — selecting "none" produces 0 pairs (dead/unclear option).
- Stray plain backward-compat probe session may exist in the store (created during live verification).
