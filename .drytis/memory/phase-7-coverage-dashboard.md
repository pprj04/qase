# Phase 7 Coverage dashboard — key findings (ticket #13445)

## Critical API-shape trap
The facade services do NOT share a uniform call signature:
- `environments.list(filters)` — FILTERS ONLY (tenant injected internally, environmentService.js L387)
- `testCases.list(filters)` — FILTERS ONLY (testCaseService.js L237) — backend level takes (tenant, filters), facade level does not
- `runs.list(options)` — one arg

Original coverageService code called `environments.list(tenantContext, filters)`; the filters were silently dropped → environment dimension truncated to the default 500 cap while the workspace has 990 active environments. Live symptom: metrics showed `environments: 500` despite `/api/environments?limit=1000` returning 990. This would have inflated coveragePct once test cases exist (dropped columns' assigned pairs excluded from denominator via envIndex.has filter).

Fix: facade pages `environments.list({active:true, limit:1000, offset})` until a short page. Verified live: 990.

## Coverage aggregation semantics (spec: .drytis/specs/phase-7-coverage-dashboard.md)
- Two indexes per (caseNumber, envId): `latest` (ANY status, drives cell display) vs `latestExecuted` (done/error only, drives executed/passed counting) — a pair counts executed once it has ≥1 completed run even if a newer run is live.
- PASS_VERDICTS = pass | pass_with_issues; verdict from run.report?.verdict; done-no-report = executed, never passed.
- Unassigned-environment runs → cells with unassigned:true, never counted.
- Cell states: cov-none / cov-idle ('○', run created never started — NOT pulsing) / cov-live / cov-pass / cov-pass-warn / cov-fail / cov-blocked / cov-exec.

## Verification notes
- `runs.listAll()` (unscoped full records) added to both stores for coverage; local = store.allSessions(), postgres = repository.loadAll().
- No public API sets a report verdict directly (reports come from the agent flow) — executed/passed path verified via computeCoverage with real session shapes.
- /api/sessions returns a BARE ARRAY (not {sessions:[]}). Non-GET needs X-CSRF-Token decoded from qase_csrf cookie. Login throttles: 10/account + 40/ip per 15 min — rapid scripted logins → 429.
- Deleting sessions by editing .qase/sessions.json while the server runs gets overwritten by the live store's persist — always delete via API.
- qualify-agent: must `set -a && . /drytis-config/environments/*.env` first; runs against z-ai/glm-5.2 via project gateway. Honest blocked verdict when browser safety blocks the localhost fixture — expected, not a defect.

Review notes: .drytis/memory/phase-7-coverage-dashboard-review.md (2 rounds, all PASS).
