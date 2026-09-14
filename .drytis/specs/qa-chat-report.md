# #10640 Concise QA completion report in chat

The agent loop intentionally stops after finish_qa_report succeeds. This prevents a final natural-language reply, leaving promises to publish as the last chat message even though the detailed report exists.

- [x] Every successfully finalized QA run posts a durable agent message before done.
- [x] Message contains verdict, short summary, recorded issue count, highest-severity issue titles and observed behavior, and a pointer to the full Report/Findings tabs.
- [x] No-findings and blocked outcomes are explicit and scope-limited; skipped coverage is disclosed.
- [x] Summary is bounded and uses saved evidence, without another model request.
- [x] Repeated finalization handling does not duplicate a report message; new reports get new summaries.
- [x] Unfinished/stopped/failed runs are not described as completed; Founder/SQA stay unchanged.
- [x] Tests cover formatting and actual runTurn completion; live browser verifies chat display and reload persistence using fixtures.

Verification: Node tests, tester browser tests, runtime infrastructure gate, independent review. Preserve prior #10639 changes and user attachments. No credentials, dependencies, schema, or service configuration changes.

Verified 2026-09-13: full suite 461 passed / 6 skipped; added real JSON-store runTurn persistence test passed (4 store tests). Independent reviewer passed. Tester passed all three QA scenarios on live desktop/mobile UI and Founder regression with zero page errors; isolated API/SSE fixtures, no paid runs. Evidence: test-results/qa-chat-report/ and test-results/founder-completion/. Runtime service/Caddy healthy; root, healthz and readyz HTTP 200. Runtime started after implementation changes. Remote branch matches HEAD. Remote infrastructure metadata unavailable; persisted local config inspected instead.
