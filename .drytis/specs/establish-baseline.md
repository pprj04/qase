# Establish the baseline — #12950

Audit the existing Qase application before further changes. No application,
dependency, configuration, deployment or runtime-data changes are in scope.

## Acceptance criteria
- [x] Identify current branch, revision, remote synchronization and existing changes.
- [x] Identify architecture and documented verification commands.
- [x] Run baseline automated verification and record pass/failure/skip counts.
- [x] Check the live preview and record health/readiness responses.
- [x] Record limitations and existing issues in the ticket for engineering review.

## Verification
Use the existing `npm run verify` suite and GET requests to the preview root,
`/healthz`, and `/readyz`. Failures are baseline findings, not authorization to
repair application behavior. Browser and infrastructure qualification of a new
implementation are outside this audit; no implementation or deployment occurs.

## Results — 2026-09-25
- Branch `PUSHKAR`, HEAD and remote tip `a8b271b20b25ae3cfcb53d3fff71d2fce9033520`.
- Four preexisting untracked files preserved (three memory notes and one userDocs image).
- Node v24.19.0; Qase 0.1.0, Express API, static browser UI, Playwright agent,
  local/PostgreSQL storage and optional distributed Redis workers.
- Syntax: 185 files pass. Private-path exclusions and credential-signature scan pass.
- Unrestricted `npm run verify`: 501 tests, 491 pass, 1 fail, 9 skip.
  Failure: `server/drytisTransport.test.js`, outbound bounds test, invalid nonce.
  Matches `.drytis/memory/drytis-transport-nonce-flake.md`; no repair attempted.
- Initial sandbox run reported 71 passing and 8 failing test-file entries;
  unrestricted results above supersede those restricted-environment results.
- Preview root, health and readiness returned HTTP 200. Health body `OK`,
  readiness body `{"status":"ready"}`. Health transfer also reported TLS EOF.
- No browser E2E, configured-model qualification, database provisioning, deployment,
  or production-capacity qualification performed. This is not a release approval.
- Existing quarantined/runtime directories contain filesystem corruption symptoms;
  active source syntax and reads used in verification succeeded.
- Detailed command output: `/tmp/qase-baseline-verify-unrestricted.log` (ephemeral).
