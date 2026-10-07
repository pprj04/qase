# SQA-mode User Feedback — codebase findings (planning session, branch MANOJ)

QA feedback feature exists; extending to SQA mode. Key facts found:

## Lifecycle
- SQA sessions live in the SAME store/qa_runs table (run_mode column, migration 008; CHECK qa_runs_mode_valid).
- sqa.finalizedAt set in server/sqaService.js:414-421 finishSqaAssessment(), triggered by the `finish_sqa_assessment` tool (server/sqaTools.js:228).
- On finish, runStore.commit(session,'sqa',{assessment,final:true}) → SSE event type 'sqa' with final:true; frontend case 'sqa' at public/app.js:3708-3720.
- After tool loop, agent.js completeRun() (line 613) → runStore.setStatus(session,'done') (agent.js:630) — applies to ALL modes incl. sqa. Status SSE handled at app.js:3784+, with sqa re-render at 3803-3806.

## Backend gating (NO mode restriction server-side)
- POST /api/feedback (server/app.js:533-586) only checks session.status in ['done','error'] — SQA runs DO reach 'done' → server would ACCEPT SQA feedback today.
- feedbackStore.js, postgres/feedbackRepository.js, migration 017_run_feedback.sql: zero 'mode' checks.

## Frontend restriction (the actual gate)
- public/app.js:1319-1324 feedbackEligible(): explicitly excludes session.mode === 'sqa' and 'founder'. Called by openFeedbackModal (1363), syncFeedbackForSession (1346), status handler (3815). This is the ONLY SQA blocker.

## Report paths
- .md: app.js:1111-1112 `buildSqaReportMarkdown(session.sqa.assessment)` — assessment only, NOT session (defined server/sqaAssessment.js:423). attachUserFeedback NOT called on SQA .md path.
- .pdf: app.js:1143 `renderReportPdf(await attachUserFeedback(session, userId))` — runs for ALL modes; buildReportHtml (reportPdf.js:511-515) branches to buildSqaBody(session) which receives full session but does NOT emit feedbackSectionHtml (only buildQaBody does, line 182).
- QA .md embed: server/report.js:109-132 buildFeedbackSectionMarkdown(session.userFeedback).

## SQA UI
- renderReport() app.js:2601-2603 delegates SQA to renderSqaReportTab() (2935-2963) which appends renderSqaReportActions() (3077-3162) — buttons: Download .md / Copy report / Copy fix prompts / Download fix prompts / Download PDF. NO Provide Feedback button and NO renderFeedback()/renderReportFeedbackSection (those only run on the QA path, renderReport 2745-2750).
- renderSqa() (3030-3075) appends renderSqaReportActions() when lifecycle.finalized.

## Modal metadata
- openFeedbackModal (app.js:1361-1408) computes duration from session.completedAt/startedAt/pausedSeconds — SQA sessions DO get startedAt (store.js applyStatusTiming:509 on 'running', completedAt:528 on 'done'); frontend also gets timing from SSE status event.timing (app.js:3790-3799). Modal would work unchanged for SQA once feedbackEligible is relaxed.

## Implementation checklist derived
1. Relax feedbackEligible (app.js:1319).
2. Add Provide/View Feedback button + feedback section in renderSqaReportTab / renderSqaReportActions.
3. For .md: either pass session into a new SQA markdown builder or attach feedback separately (buildSqaReportMarkdown takes assessment only).
4. For .pdf: attachUserFeedback already called before renderReportPdf; add feedbackSectionHtml to buildSqaBody.
5. Server POST /api/feedback needs no changes.
