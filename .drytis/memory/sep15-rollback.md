# Sep-15 rollback (2026-09-16, #11207)

User directed: "avoid yesterday's commits, change back to the old version
before yesterday's commits." Interpreted as full revert of ALL 2026-09-15
commits — server code now byte-identical to af72f83 (2026-09-14 18:20, the
last Sep-14 commit).

**What got rolled back (now sitting in Open on the board):**
- 873f770: /qase-test stuck-run repro banner injected at run start (the
  "error" the user reported at run start) + /api/health behind auth gate
- dc66ab0: /qase-test chat command + runtime-reuse 500 fix
- ed0d372: GET /api/health endpoint
- 1be3796: review hardening (SSRF guards default-on, throttle eviction,
  forwarded-host last hop, fail-closed roles, sanitized route errors,
  agent progress-stream)
- 01591df: fail-closed auth store, meeting-target alias, hex nonce

**What was deliberately KEPT (security, not feature):**
- .gitignore ignores for .drytis/cred.json, session dumps, quarantine dirs
  (server.corrupt-*/, userDocs.corrupt-*/, specs.corrupt-*/) — reverting
  them would have re-tracked cred.json (passwords!)
- Memory notes + userDocs images added today

**Revert mechanics that worked:**
- `git revert --no-commit A..B` excludes A — the range `01591df..78468f9`
  missed 01591df itself; second `git revert 01591df` completed the rollback.
- cred.json wants to come back as "A" (added) on every revert touching it —
  always `git restore --staged .drytis/cred.json` before committing.
- Verification: `git diff af72f83..HEAD --name-only` filtered to non-docs
  paths shows ZERO server/ files differing.

**State after rollback:** tests 469/463 pass/0 fail/6 skipped (the Sep-15
commits had added 36 tests — now gone with the code). Server restarted,
banner confirmed absent from served HTML, preview 200. main is ahead of
origin/main by ~5 commits (reverts + today's docs) — NOT yet published.