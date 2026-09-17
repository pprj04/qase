# Reconcile LIVE security hardening into preview

Ticket: #11298

Restore the security-only portions of the existing `origin/LIVE` hardening
revision into the current `main` preview after the Sep-15 rollback. Preserve
the later rollback's product behavior and all unrelated uncommitted work.

Acceptance criteria:

- [x] Preserve all unrelated tracked and untracked workspace changes.
- [x] Restore default-on private-network/SSRF guards, with the documented
      development-only explicit opt-out.
- [x] Restore last-hop forwarded-host parsing, bounded auth-throttle eviction,
      fail-closed default roles, sanitized route errors, and mode-0600 session
      persistence.
- [x] Serialize per-account memory quota checks so concurrent inserts cannot
      exceed the limit or cross tenant/project boundaries.
- [x] Do not restore the unrelated agent progress-stream work bundled into the
      historical LIVE commit.
- [x] Add or restore focused regression coverage before implementation and
      make the focused and full automated test suites pass.
- [x] Run the infrastructure gate and confirm the preview root is HTTP 200.
- [x] Record the status and relationships of every local and remote project
      branch without force-updating or publishing any branch.
- [x] Record implementation and verification evidence on #11298 and move it
      to In Review.

## Repository organisation follow-up — 2026-09-17

- [x] Preserve every tracked and untracked workspace change in a commit on
      `DEV`, the ongoing development branch.
- [x] Fast-forward `LIVE`, the production branch, to the same fully verified
      revision so it contains all current changes without rewriting history.
- [x] Remove local and remote `NIHARIKA`, `MANOJ`, and `PUSHKAR` branches only
      after confirming their tips are ancestors of the retained branches.
- [x] Fetch before reconciliation, publish the resulting `DEV` and `LIVE`
      refs, and verify both remote refs match their local counterparts.
- [x] Leave the working tree clean and record the final branch topology on
      ticket #11298.

## Repository organisation verification — 2026-09-17

- Cleared stale `revert --no-commit` sequencer metadata with `git revert
  --quit`; no files or commits were discarded.
- Consolidated every tracked and untracked workspace change in commit
  `ea5200a`, then fast-forwarded local `DEV` through normal history.
- Full automated suite passed outside the network-bind sandbox: 486 passed,
  0 failed, and 9 intentionally skipped (495 total).
- Confirmed `origin/NIHARIKA`, `origin/MANOJ`, `origin/PUSHKAR`, local
  `PUSHKAR`, and the former `origin/LIVE` tip were all ancestors of `DEV`
  before deletion or advancement.
- Published `DEV` and `LIVE` to the consolidated revision without force, then
  deleted remote `NIHARIKA`, `MANOJ`, and `PUSHKAR` plus local `PUSHKAR`.
- A final fetch/prune and exact-ref comparison is required after this record's
  commit is published to both retained branches.

## Verification record — 2026-09-17

- Focused security/route suites: 65/65 passed before review follow-up; final
  app + SQA route-boundary suite: 39/39 passed.
- Full suite after the final fix: 486 passed, 0 failed, 9 intentionally skipped.
- One earlier full run hit the documented pre-existing random Drytis nonce
  flake; the unchanged rerun passed. The previously rolled-back nonce change
  was not restored.
- Managed production-command service restarted on the final workspace state.
  App port 5173, local Caddy root, and public preview each returned HTTP 200,
  33,269 bytes, with identical SHA-256
  `5ff9bf1089641fb69dfb296e30eafb7045558e145b2d9fac38311b5e4bddd832`.
- Browser smoke passed on desktop and mobile: sign-in/create-account switching,
  password visibility, and motion controls worked; no unexpected 5xx or page
  errors. Anonymous `/api/auth/me` returned the expected 401.
- Three review rounds found and drove fixes for environment-scoped SSRF opt-out,
  generic error leakage, explicit public validation errors, spoof-resistant
  auth errors, and actionable SQA reviewer validation. All named findings were
  resolved and covered by the final green suites.
- Agent progress-stream files from `1be3796` remain absent/unmodified.

## Branch record — no branches published or force-updated

- `main` `1c4eb30`: 6 commits ahead of `origin/main`, which is `78468f9`.
- Local `DEV` and `PUSHKAR` are both `af72f83`; `DEV` is 9 commits behind
  `origin/DEV`, and local `PUSHKAR` is 3 commits behind `origin/PUSHKAR`.
- `origin/LIVE`, `origin/MANOJ`, `origin/NIHARIKA`, and `origin/PUSHKAR` all
  point to hardening commit `1be3796`.
- `origin/main` and `origin/DEV` both point to `78468f9`, six commits after
  `1be3796`; current `main` is twelve commits after `1be3796`.
- `upstream/main` is `0fa6f7b`, an ancestor 28 commits behind current `main`.
