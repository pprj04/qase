# Review: ticket #13661 default-select QA tests (2026 review)

Result: PASS on all 9 ticket criteria; 2 WARNs, no FAILs.

- Validation lives at the API boundary (server/appQaSelection.js): unknown/duplicate/empty/>32 ids → 400. store.js only re-checks "non-empty array of strings" (NOT catalog membership) — acceptable defense-in-depth tradeoff, documented in store.js comment, but weaker than the spec file's wording ("validate against the catalog").
- Spec's "Integration: POST /api/sessions with/without selectedTests" test is NOT present — validation covered only by unit tests (qaTestSelection.test.js). Gap noted, not blocking.
- Tests: `node --test server/qaUiSelection.test.js server/qaTestSelection.test.js` = 9 pass; `node --test server/app.test.js server/agent.test.js` = 64 pass.
- postgres migration 018_qa_test_selection.sql adds selected_tests text[] with DB-level CHECK (non-null, ≤32, no NULL elements).
- qaTestOption builder uses safe DOM APIs (createElement/textValue), no innerHTML in QA block — verified by static test.
- Submit button label changed "Start QA run" → "Start test" per ticket wording (spec .md still says "Start QA run").
- /api/qa/catalog returns 401 unauthenticated (verified live); role checks (feedback 403, SQA evidence 403) untouched in diff.
