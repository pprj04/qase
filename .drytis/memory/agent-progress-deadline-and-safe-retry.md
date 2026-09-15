# Agent progress deadline (#10638)

SDK provider inactivity timeout resets on reasoning. server/progressStream.js bounds silence to 120s and time without a successful tool result to 300s. Timeout aborts an attempt independently of user Stop. Pending next() and return() must close within 5s before retry is allowed. Existing model retry cap applies. Failed tools do not reset progress.

SDK tool jobs can outlive iterator closure. agent.js counts actual executors in try/finally and checks abort before/after activity creation. Surviving jobs or failed closure quarantine runtime against automatic retries and manual reuse. Never race an unfinished attempt against a new run on the same runtime.

Verification: 478 passed, 9 skipped, 0 failed. Full suite needs permission to bind localhost. Browser verification uses live frontend with controlled Stop API/SSE; no actual paid provider stall was recreated.

Pre-existing sessions.json filesystem corruption (EUCLEAN) remains preserved. Passing health does not prove the screenshot run was recovered. MCP memory_save unavailable due project-selection context mismatch, so this note was saved locally.
