# #10639 Display the founders report on completion

The existing dashboard renders Founder reports but does not select the Report tab when a run completes. Reuse its existing report presentation and completion state.

- [x] A done Founder run with a finalized report automatically opens Report.
- [x] Loading a completed Founder run opens its report, including after reconnect.
- [x] Either ordering of final report and done status works.
- [x] Running, failed, stopped, and unfinished runs do not open an empty report.
- [x] Repeated events do not override a user's subsequent tab selection.
- [x] QA and SQA behavior stays unchanged.

Validation: executable regression tests for selection behavior, existing presentation tests, live preview browser tests, infrastructure gate and independent review.

Verified: 17 focused Node tests pass; 11 live-asset browser scenarios pass with fixture API/SSE and zero browser errors. Independent code review passed. Runtime infrastructure passed (production Node, procmgr, root Caddy, HTTP 200). Saved environment metadata could not be queried because Drytis project-details lacks API_BASE_URL; no environment or service changes were made. Browser artifacts: test-results/founder-completion/.
