# User Feedback for SQA Mode

Branch: MANOJ. Goal: extend the existing feedback feature to SQA runs — auto-open
modal on SQA completion, per-run storage (already supported), USER FEEDBACK section in
the SQA report, feedback embedded in SQA report downloads (.md + .pdf). Reuse all
existing stores, APIs, auth, and the existing #feedback-modal. Founder mode stays
excluded (spec scopes this to SQA Mode only).

## Research findings (grounding)
- SQA sessions share qa_runs with QA (run_mode column); they reach status 'done' via
  completeRun (server/agent.js:613-633) when finish_sqa_assessment finalizes
  (server/sqaService.js:403-427 sets sqa.finalizedAt).
- Backend feedback is mode-agnostic: POST /api/feedback gates only on status
  done/error (server/app.js:548); no mode checks in feedbackStore.js /
  feedbackRepository.js / migration. SQA feedback would already save today.
- The ONLY QA-only gate is frontend feedbackEligible() (public/app.js:1319-1324,
  added in feedback v4) — must be relaxed to include sqa.
- SQA completion SSE: 'status' done event (app.js:3784-3823) already calls
  syncFeedbackForSession for eligible sessions; 'sqa' final event fires toast +
  renderSqa (app.js:3708-3720).
- SQA report tab: renderReport() delegates to renderSqaReportTab (app.js:2601-2604);
  SQA has its OWN actions row renderSqaReportActions (3077-3162) with download .md/.pdf
  buttons — the QA feedback button never runs for SQA. Add Provide/View Feedback
  button + USER FEEDBACK section there.
- Markdown path (server/app.js:1111-1116): SQA branch calls
  buildSqaReportMarkdown(session.sqa.assessment) WITHOUT attachUserFeedback.
  buildSqaReportMarkdown takes the assessment only (validates schema) — so append the
  feedback section in app.js after building, reusing report.js
  buildFeedbackSectionMarkdown-style helper reading session.userFeedback.
- PDF path (server/app.js:1143): attachUserFeedback ALREADY runs for all modes;
  reportPdf.js buildSqaBody (207+) never calls feedbackSectionHtml (only buildQaBody
  line 182 does). Append feedbackSectionHtml(session) at end of buildSqaBody.
- Modal duration works for SQA unchanged (startedAt/completedAt set mode-agnostically
  in server/store.js:509-528, delivered via SSE timing payload).
- Duplicate prevention, edit-own, validation, 409/400 handling all inherited from the
  existing API/store. Note: some tests assert QA-only scope — update them.

## Phase 1 — Frontend: SQA feedback eligibility + UI
Files: public/app.js (+ index.html/styles.css only if needed).
- feedbackEligible(): allow mode 'sqa' (keep excluding 'founder' — spec scopes SQA).
  Update comment; update tests that assert QA-only scope.
- SQA status-done path (3815-3818) already syncs/prompt once eligible — verify the
  auto-prompt fires for SQA (feedbackAutoPrompted set), and that the 'sqa' final event
  path does not double-open (syncFeedbackForSession is idempotent per run).
- renderSqaReportActions: append 'Provide Feedback'/'View Feedback' button (reuses
  openFeedbackModal; label follows state.runRatings / state.feedback.existing).
- SQA report tab: render USER FEEDBACK section (reuse report feedback section
  rendering; Submitted By/On, rating, description).
- loadRunRatingBadges must include SQA runs (verify run list covers all modes).

## Phase 2 — Server: SQA report embeds + test updates
Files: server/app.js, server/reportPdf.js, server/report.js (helper reuse),
server/feedbackApi.test.js / feedback.test.js as needed.
- .md: SQA branch — attachUserFeedback(session, userId) then append feedback section
  (reuse/adapt buildFeedbackSectionMarkdown; it must handle assessment-only call sites
  by taking the session).
- .pdf: append feedbackSectionHtml(session) at end of buildSqaBody (guarded on
  session.userFeedback presence, same as QA).
- Ensure feedback is submitter-scoped (forRun) — Run isolation by construction.
- Update tests asserting QA-only feedback scope; add SQA-path coverage.

## Phase 3 — QA verification + publish to MANOJ
- E2E: SQA run → no modal while running → modal on completion → ratings 1-5 → submit →
  success message → USER FEEDBACK in SQA report → .md + .pdf downloads contain
  feedback → second SQA run isolation → refresh persistence → duplicate → View
  Feedback/edit → QA-mode feedback unaffected (no regression) → console clean.
- Suite green; publish to origin/MANOJ.
