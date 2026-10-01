# Phase 7 · Coverage dashboard (#13445) review — 2026-09-30 (round 2, post-fix)

Round 2: suite 756/747/0-fail/9-skip. Live `/api/coverage` (auth) now returns **environments: 990** (was 500) — truncation fixed via paging loop in `createCoverageService.environmentList` (coverageService.js L140-158, limit 1000 + offset until short page). Route still 401 unauth.

## Fixes verified
- Env paging: `environments.list(filters)` single-arg call (facade injects tenant itself — environmentService.js L387-388); new test 'pages the environment dimension past the 1000 cap' (coverageService.test.js L184-203) asserts both pages aggregated + offsets [0, 1000].
- Idle cells: `coverageCellMeta` maps `idle` → static `cov-idle` '○' "run created — never started" (deviceMatrixView.js L72); tests assert cls + full meta alphabet (test L70, L81); `.cov-idle` style at styles.css L8359.

## New WARN (round 2): testCases.list arg-form mismatch in coverage facade
coverageService.js L137 calls `testCases.list(tenantContext, {})` (two-arg), but the facade actually injected by serviceFactory (`createTestCaseService`, testCaseService.js L237) is **one-arg** `list(filters = {})` — the tenantContext object is silently consumed as the filters argument. Benign today: createTenantContext (tenancy.js L111+) returns only org/project/actor ids + slugs/names — no `search`/`tag`/`environmentId` keys — and both backends ignore unknown filter keys while injecting the tenant themselves. But it contradicts the code comment (L146-147) and the leader's stated two-arg form, which only holds at the *backend* level, not the facade. Latent trap: if anyone adds a filter key named like a tenant field (e.g. `search` on the context) it would silently filter. Recommend aligning to `testCases.list({})` in a follow-up.

## Carried over (unchanged, non-blocking)
- Detail popover is latest-run-only (spec's own data contract has no history array) — spec gap, not implementation defect.
- Workspace still has 0 test cases → live matrix rows unexercised end-to-end (rows: []; unit + route tests cover rendering).
- Unchanged honesty rules still hold: executed = latest done/error run; pass only on report.verdict pass|pass_with_issues; unassigned-env runs surface as extra cells, never counted.
