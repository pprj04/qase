# Code Review — Phase 7 commits (953b994 cutover + 58ed7a7 legacy removal)

Scope: / and /login serve React (953b994); legacy public/ files deleted, pinning tests reworked to reactUiContracts(2) (58ed7a7). Infra verified PASS separately (verify-phase7-cutover-infra.md).

## Verdicts
1. Sanity PASS (all services RUNNING; / → 200, title "QASE — new UI").
2. npm test 758/738 pass/0 fail/20 skip (exact match); tsc clean; build:react OK.
3. Dangling refs **FAIL (one real)**: `scripts/verify.mjs:37` still requires `public/index.html` (deleted) → `npm run verify` exits 1. It is wired into CI (`.github/workflows/verify.yml:49`) and documented in README/operations-runbook → CI is red after cutover. Remaining matches are comments only (src/lib/*.ts headers, src/main.tsx:12) — benign.
4. DrytisBoardPanel port PASS (default-checked via Set init, accept-all both directions, guard string exact, POST {acceptedFindingIds}, delivered/delivering/failed/empty states incl. extra 'requested' handling; wired at QaReportView.tsx:368).
5. Founder auto-open PASS — ref-keyed once-per-finalizedAt; only fires on founder+done; will not re-yank because key check precedes setTab and user tab changes are not tracked/overwritten afterwards. (Same instant-switch semantics as legacy.)
6. Contract coverage PASS — mapping documented in header comments of reactUiContracts*.test.js; 16 deleted legacy test files covered (a)/(b); entryUi/finalUiPolish/uiPrimitives pins are assertions of *absence* (obsolete-by-design, OK).
7. Security PASS — no new dangerouslySetInnerHTML sinks (only the 3 pre-existing escape-first renderMarkdown ones: Transcript 108/172, ViewerPanel 437).

## NEW environmental finding (pre-existing, not caused by Phase 7 but exposed now)
Browser-e2e scripts not in `npm test` are stale vs both the UI and the server:
- `scripts/qualify-dashboard.mjs` (npm run test:dashboard) crashes at startup: fixture services lack the `feedback` group required by server/contracts.js:15 (group added 65f9cfe "Add User Feedback feature"; script last touched 9d67123, earlier). Also drives the legacy UI (waitFor #chat-title).
- `scripts/test-auth-browser.mjs` (npm run test:auth) times out waiting for `#auth-gate` (legacy DOM id) — tests the React UI at / but asserts legacy selectors.
- `scripts/test-founder-completion-browser.mjs`, `test-qa-chat-report-browser.mjs` similarly pin legacy DOM (`#run-list [data-id]`, `#chat-title`) → fail.
- `scripts/test-browser.mjs` runs but 4/6 tests skip.
All ran in CI (verify.yml: npm run test:browser + test:dashboard). CI was already red before Phase 7 (feedback group); Phase 7's verify.mjs break adds a second red step. Needs a follow-up task: update scripts/verify.mjs required-file list and port or retire the legacy-DOM browser scripts.

No fixes applied (reviewer role).
