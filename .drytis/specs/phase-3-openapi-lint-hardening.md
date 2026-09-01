# Phase 3 — Harden lint/tests that would have caught this

## Goal
The two blockers existed because the lint skipped non-GET ops and no test compared the live spec to the docs. Fix the tooling so this class of drift can't silently reopen.

## Files to change
- `scripts/validate-openapi.mjs`
- `tests-real/pulse-openapi-document.test.js`

## Work
1. `scripts/validate-openapi.mjs`: remove the non-GET skip (line 78: `if (method.toUpperCase() !== 'GET') continue;`). Lint all operations: operationId unique/snake_case/≤64, summary+tags present, declared success response has a JSON schema, 4xx responses documented. Keep collection-shape rules GET-scoped (paging params etc. apply to GET collections).
2. `tests-real/pulse-openapi-document.test.js`:
   - Loosen the every-path-has-`get` assertion (:53-60) to per-method — POST-only paths are legal once integration ops land (Phase 2).
   - Add: every path under `/api/v1/integration/` carries `security: [{ hmacAuth: [] }]`.
   - Add: audited nullable fields (Phase 1 list) declare an `anyOf` union including `{type: 'null'}`.
   - Keep: no standalone `{"type":"null"}` (rule at :112-119) — now exercised by more fields.

## Acceptance criteria (true in the running app)
- [ ] `npm run test:openapi` lints all methods, not only GET, and passes against the updated document
- [ ] The unit test suite fails if an integration path loses its hmacAuth security or a nullable field loses its union
- [ ] All existing tests still pass (no regressions in test:gate categories)

## Tests
- These changes ARE the tests; verify by intentionally flipping one nullable field back to bare type in a scratch run (must fail), then reverting.

## Edge cases
- POST ops in the v2 surface (if any exist) must also conform; if any legacy op lacks an operationId, fix the op entry, not the linter
- Keep <8MB doc-size check intact
