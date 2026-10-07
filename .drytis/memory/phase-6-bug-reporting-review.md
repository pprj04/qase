# Review — Ticket #13443 · Phase 6 "Bug reporting" (2026-09-29)

No phase-6 spec file exists in /workspace/.drytis/specs/ (checked; the specs dir has phase-1..24 but no phase-6/bug-reporting) — the ticket body served as spec. Verdict: PASS on all criteria, one WARN.

## Verified
- bugService.js: BugValidationError code QASE_BUG_INVALID; title ≤300; severity/status enums; BUG-XXXX numbering; atomic tmp+rename writes (mode 0600) to .qase/bugs.json; facade auto-associates envId/snapshot/executionLevel/linkedTestCaseId from linked run with explicit-wins; freezes snapshot from environments service when only id passed. All covered by 7 unit tests (bugService.test.js).
- Migration 020_bugs.sql: CHECK constraints mirror service validation; RLS policy on (organization_id, project_id) via qase.* GUCs, WITH CHECK included; unique bug_number per tenant.
- bugRepository.js: parameterized SQL throughout, set_config tenant GUCs before each query, requireTenant guard. Wired in serviceFactory both local (L109) and postgres (L179) paths.
- Routes in bugApi.js mounted at app.js L485-491, after global /api auth+CSRF middleware (L217-239). Live curl: 401 unauth GET/POST, 403 POST without CSRF header, 422 invalid severity, 404 unknown, 201/PATCH 200/DELETE 204 with session+CSRF.
- bugView.js: DOM built exclusively via textContent helper `h()` — XSS-safe. encodeURIComponent on bugNumber in PATCH path. Inline status PATCH + "Open linked run" jump; severity-sorted rows; filters via bugMatches (5 tests).
- app.js: createBugReport POSTs /bugs from freshest run with findings (title sliced to 300 server-side too), refreshBugs on boot (L4354) + after creation.
- npm test: 740 tests, 731 pass, 0 fail, 9 skipped — matches expectation. Both new test files run within it (bugView 5/5, bugService 7/7).

## WARN
- Postgres bugRepository has NO unit/integration test coverage (only local JSON backend tested). Tenant isolation relies on untested RLS + set_config wiring; the requireTenant throw path is untested.

## Minor notes (not spec violations)
- Local JSON backend ignores tenant (single-tenant local mode, consistent with testCaseService pattern).
- No guard against duplicate bug creation from repeated "Report bug" clicks (each click = new BUG-XXXX), same pattern as Phase 23's dup-run WARN.
