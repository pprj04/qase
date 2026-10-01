# React UI Phase 7 — cutover complete, deployed to production (Oct 1 2026)

## Final state
- ALL React UI tickets #14023-#14029 Done. Ticket #14029 closed.
- `/` and `/login` serve the React build (public/app-react/index.html). `/app-react/` kept as alias.
- 17 legacy frontend files DELETED from public/ (app.js, index.html, styles.css, entry*, bugsView*, uiPrimitives, qaKickoff, followUp.*, founderPresentation, founderView, questionPresentation, sqaPresentation, fixPromptBuilder).
- server/questionPresentation.js is a NEW shared module — server/agent.js imports isCredentialQuestion from it.
- 16 legacy pinning test files deleted; contracts preserved in server/reactUiContracts.test.js (11) + reactUiContracts2.test.js (16). reactPhase6Pins + reactReportViews no longer read legacy sources.
- scripts/verify.mjs required-file updated to public/app-react/index.html (npm run verify green; reviewer FAIL fixed).

## New React surfaces added in Phase 7 (parity completions)
- DrytisBoardPanel.tsx: accept-all + push POST /sessions/:id/drytis/push {acceptedFindingIds}, wired into QaReportView. `libwebrtc-audio-processing-1` package does NOT exist on Debian 12 — removed from dep list.
- SqaReportActions (in SqaView.tsx): .md/.pdf exports, Copy report, Copy fix prompts, qase-sqa-fix-prompts.md; 409 → 'still being finalized'.
- Transcript.tsx conversation header: title (hostOf / founder-SQA target names), engine pill non-chromium, LIVE pill while running.
- Resume button (interrupted/error) sends 'continue'. Founder report auto-open: once per `${id}:${finalizedAt}`, setTab('report').

## Verification
- Suite 758 tests / 738 pass / 0 fail / 20 skipped. tsc + build:react + npm run verify green.
- infra_verifier PASS (all 7 sections). Reviewer PASS after verify.mjs fix. Tester PASS 6/6 (SQA/Founder auto-open untestable — no such runs; pinned in source contracts).
- Production qase.drytis.com: updated to origin/DEV 5ce0791, npm ci + build:react, browser deps installed (TOTAL_MISSING=0), Chromium launches and renders the React shell (title + hero verified via Playwright in prod).

## Traps hit
- restart_production AGAIN left prod one commit behind → manual `git fetch origin DEV; git reset --hard origin/DEV` needed (see prod-deploy-ritual.md).
- Fresh prod pod AGAIN lost browser deps → manual apt install with apt-get update first (index files fail without update; libwebrtc-audio-processing-1 unavailable on bookworm — exclude it).
- Setup script updated with build:react as REQUIRED step + hard failure if index.html missing.

## Remaining known gaps (CI-only, not user-facing)
- CI browser e2e scripts stale: qualify-dashboard.mjs crashes (missing 'feedback' fixture group), test-auth-browser.mjs pins legacy #auth-gate, test-founder-completion/test-qa-chat-report pin legacy DOM ids. CI cannot pass on DEV post-cutover until ported/retired.