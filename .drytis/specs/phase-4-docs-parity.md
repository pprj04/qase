# Phase 4 — Docs sync + live-spec ↔ docs parity test

## Goal
`docs/openapi.yaml` and `docs/integration-guide.md` describe the same contract as the served `/openapi.json`, and a test keeps them locked together.

## Files to change
- `docs/openapi.yaml`
- `docs/integration-guide.md`
- new `tests-real/openapi-docs-parity.test.js`
- `package.json` (+ js-yaml devDependency)

## Work
1. Apply the four corrections to `docs/openapi.yaml` found during exploration: add `decision-trace` path; fix `GET /keys` response shape to `{integrations: [...]}`; add 409 `idempotency_key_reused` to missions-create responses; fix mission-findings default limit 100 → 50.
2. Update `docs/integration-guide.md` §1–4 to note the live spec at `/openapi.json` now includes the integration surface (with hmacAuth scheme) and that it is the canonical contract; the YAML remains the human-readable mirror.
3. New parity test `tests-real/openapi-docs-parity.test.js`:
   - Loads `docs/openapi.yaml` (via js-yaml) and `buildOpenApiDocument()` output.
   - Asserts path+method parity between the two (every path:method in YAML exists in the live doc and vice versa — the live doc additionally carries /api/v2 which YAML intentionally doesn't cover; scope the parity to `/api/v1/integration/*`).
   - Asserts success status codes match per operation (200/201/202/409 as documented).
   - Asserts `security` on integration ops is hmacAuth in both.
4. Wire into the test runner: add `openapi-docs-parity` to the suite list in `scripts/run-tests.mjs` (or the category scripts in package.json) so it runs in the gate.

## Acceptance criteria (true in the running app)
- [ ] `docs/openapi.yaml` declares decision-trace, correct keys shape, 409 responses, and limit default 50 — matching the live spec
- [ ] The parity test runs as part of the regular suite and passes
- [ ] Dropping a path from docs/openapi.yaml (scratch check) makes the parity test fail

## Tests
- The parity test itself; a manual negative check once (scratch edit → red → revert).

## Edge cases
- YAML is maintained by hand (no generator exists) — keep it minimal and let the parity test be the enforcement
- js-yaml must go into devDependencies only; `npm install` cache is /tmp/npm-cache per setup script
