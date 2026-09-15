# Fix authorized Drytis meeting navigation

Ticket: #10897

The declared Studio meeting URL hands off to the separate Drytis Meeting host through a button. Permit only the same meeting entry path on HTTPS meeting.drytis.dev when the declared target is an HTTPS studio.drytis.ai meeting URL. This is an exact target alias, not a general origin allowlist. Query parameters may change during guest joining. Existing participation confirmation and public-network checks remain in effect. Newly loaded server code requires a fresh run; do not claim page reload changes server policy.

- [x] Regression fails before implementation and passes after.
- [x] Same meeting handoff works through button navigation, client-side redirects and new tabs.
- [x] Different meetings, unrelated paths/hosts, HTTP, credentials and private DNS remain blocked in production-policy tests.
- [x] Full infra, reviewer and browser tester verification recorded, including live preview.
- [x] Record runtime activation limitations honestly and return ticket for review only when verified.

Validation: 38 targeted unit/bridge/agent/prompt tests, 3 new Chromium regressions and 4 existing browser tests pass. Reviewer found no must-fix issues. Managed Qase service restarted (PID 69 -> 6079); all services RUNNING and local/live preview HTTP 200. Browser preview renders Qase sign-in.

Limits: no authenticated customer QA run or actual meeting participation tested; HTTP 302 not covered by browser fixtures. Existing runtime NODE_ENV is unset, so private-DNS enforcement remains conditional on production mode (unchanged). This update is activated on the project preview, not separately deployed production.
