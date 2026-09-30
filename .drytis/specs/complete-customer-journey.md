# Complete the customer journey — #12957 (Phase 5)

From the Phase-5 gap audit: close the first-run dead ends and export parity gaps so a brand-new user can go login → first successful run → actionable report without knowing any magic words. Findings→board push and multi-browser stay in Phases 8–9.

## 12957a — Config gate on all launcher submits

The composer checks `config.ready` (app.js:3051) but QA/SQA/Founder launchers don't — an unconfigured model creates a session that errors with a sanitized message. Add the same check + Settings redirect toast to all three launcher onsubmit handlers (app.js:2366, 2550, 2706 area).

Tests: none feasible server-side (pure frontend guard); browser-verified by tester.

## 12957b — Discoverable demo site

- QA launcher: "Try the demo site" link/button that fills the URL field with the app's own `/demo` URL (window.location.origin + '/demo'), plus a hint with demo credentials.
- Chat empty state (`#chat-empty`): add a "Try the demo site" CTA that opens the QA launcher pre-filled.
- Demo site credentials note: demo@qase.dev / demo1234 shown in the launcher hint (dev environment only).
- Do NOT change the production-disable logic (NODE_ENV gate stays; Phase 5 is dev-container scope).

Tests: static markup assertions in a new/updated ui test (launcher contains demo affordance; empty-state CTA exists).

## 12957c — First-run welcome checklist

- New authenticated user (no sessions): render a compact welcome card in the chat empty state: (1) model endpoint ready ✓/✗ (live from /api/config, click → Settings), (2) start your first run (→ launcher), (3) optionally try the demo.
- Mark `onboardingComplete` via a small API (`PATCH /api/auth/profile` if it exists — verify; else add POST /api/auth/onboarding) when the first run is started; hide the welcome card once set.
- Keep it one card, not a tour.

Tests: server test for the onboarding flag endpoint (auth required, idempotent); frontend via browser test.

## 12957d — Resume affordances

- When status is `interrupted` or terminal error, show a "Resume run" button in the transcript/status area that POSTs the composer-equivalent "continue" message (`/api/sessions/:id/message` with text "continue").
- The 409 "Stop it before sending another instruction" while running: keep, but render an inline hint under the composer when running ("Agent working — send Stop to interrupt") instead of only a toast.

Tests: none server-side (existing message endpoint); browser-verified.

## 12957e — Export parity + friendly 409s

- SQA report actions: add "Copy fix prompts" + "Download fix prompts (.md)" using the same buildAllFixPromptsMarkdown + /fix-prompts.md endpoint (works already for SQA sessions — findings array present).
- Founder report actions: leave as-is (fix prompts not meaningful); document in spec.
- Pre-finalization .md/PDF 409s: in app.js error handling for those exports, map the 409 body error to a friendly inline message ("The report is still being finalized — try again once the run completes").

Tests: extend a static ui test asserting SQA export buttons exist; 409 mapping browser-verified.

## 12957f — Out of scope (documented)

- Board push → Phase 9 (#12961); multi-browser → Phase 8 (#12960); model-settings role policy → Phase 10 (#12962, production ops); password reset/email verification → post-launch backlog; the 5 live-browser test skips → they are integration-test infrastructure, handled with Phase 10 qualification.

## Acceptance criteria
- [ ] All three launchers block submit with a Settings steer when config not ready
- [ ] QA launcher + empty state offer the demo site; demo credentials visible in dev
- [ ] New user sees welcome checklist (model status, start run); dismissed after first run via onboardingComplete
- [ ] Interrupted/errored run shows a Resume button that sends "continue" and restarts the turn
- [ ] SQA report has fix-prompt export parity with QA
- [ ] Export 409s show friendly inline messaging
- [ ] Full `npm run verify` green; reviewer + tester PASS
