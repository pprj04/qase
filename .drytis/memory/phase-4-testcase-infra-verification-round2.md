# Phase 4 Infra Verification (round 2) — RESOLVED

Round 1 FAIL: UI missing (public/testCaseView.js, public/bulkRunView.js, no wiring).

## Round 2 outcome: RESULT: PASS

Round-1 failure resolved:
- `public/testCaseView.js` (7.7 KB) + `public/bulkRunView.js` (3.9 KB) exist and are served at their URLs (200).
- Wiring confirmed: `app.js:6-7` imports; `createTestCaseView` (3527, navButton `#open-test-cases`), `createBulkRunView` (3549, navButton `#open-bulk-run`); QA-start prefill `startRunForTestCase` (3496) + `createQaRunWithCase` (3514). Footer buttons in `index.html:93-94`; `.tc-*` styles in styles.css.

Reviewer's critical defect also fixed:
- Tenant contract: `testCaseService.js:233-234,238-287` facade now passes `withTenant()` as first backend arg on every method; local backend signature is `(_tenant, …)` (153-215); serviceFactory passes `tenantContext`.

Other reported fixes verified:
- `server/postgres/testCaseRepository.test.js` exists (9 tests) — all green.
- Report header: `server/report.js:75-76` (markdown) + `server/reportPdf.js:69-71` (PDF headerBlock) render test-case title/caseNumber with snapshot fallback to testCaseId.

Tests: targeted 21/21 pass; full suite 0 fail (9 documented skips).

Standard checks all PASS: env parity 20/20 keys, single .env, QASE_PUBLIC_URL resolved; services RUNNING (qase-server pid 28029 `exec node server/index.js`); no dev processes; preview 200 real app; Caddy root→5173 with matching port binding; setup script unchanged/deploys-clean; migrations 015-017 confined to migrations dir (untracked new files, no amendments).

Standing WARN (unchanged, low risk): `/workspace/.env.example` committed without backend env_key representation (placeholder-only template).

Live probe: authenticated GET /api/test-cases → 200, Cache-Control: no-store.
