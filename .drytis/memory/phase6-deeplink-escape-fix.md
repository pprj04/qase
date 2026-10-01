# Deep link + Escape fixes — re-test 2026-10-01: PASS

Re-test of the two Phase 6 defects from the prior deep-link run:

1. **Invalid deep link param strip — FIXED.** Fresh navigation to `/app-react/?run=not-a-valid-id` → app loaded normally (0 active run rows, "What should I test today?" empty state, zero alerts, no bogus fetch), and `?run=` was stripped from location.href within ~4s (URL became `…/app-react/`). Previously the strip only ran on the success path and the dead param persisted indefinitely.
2. **Escape-to-close dialogs — FIXED.** Ctrl+N opened the "Start a QA run" launcher; a single Escape press closed it (dialog removed from DOM). Previously Escape did nothing (needed ×). Ctrl+, opened Settings; Escape closed it too.

Console: only the known ignorable /favicon.ico 404. No JS errors.

Verdict: RESULT PASS (2/2). Both defects from `phase6-deeplink-shortcuts` run resolved.
