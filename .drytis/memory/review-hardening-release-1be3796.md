# Review-hardening release 1be3796 (2026-09-15)

Security fixes from the 17-commit review (97d4254..1f74053), ticket #10967:

- **M1** SSRF/private-network guards now ON in every environment. `config.js` `testConnection`: allowPrivateNetwork defaults false, opt-out only via `QASE_ALLOW_PRIVATE_NETWORK=true` (ignored in production). `browserPolicy.js` `validatePublicDestination`: same env opt-out; the old `!production` bypass is gone.
- **M2** `instanceAccess.js`: X-Forwarded-Host takes the LAST hop (was attacker-controlled `split(',')[0]`). `QASE_TRUST_PROXY=true` was already in backend env keys (50446) — verified.
- **M3** `authThrottle.js`: 10k map cap now evicts oldest windows instead of refusing new keys (was an unauthenticated site-wide auth-DoS: fill `account:` keys → all visitors 429 for 15 min).
- **L-fixes** `auth.js`: missing role now defaults to `developer` (fail-closed; safeUser, userFromRow, loadData). `app.js`: `safeErrorResponse()` helper sanitizes filesystem-path leaks on 5 routes (AuthError keeps its message; ERR_/ENOENT-class → generic 500). `store.js`: sessions.json written 0600.
- **H1/H2** Untracked + gitignored: `userDocs/image_21567749.png` (230KB JSON session dump mislabeled as PNG), `.drytis/cred.json` (test-account passwords), `.drytis/specs/prepopulate-llm-key-new-users.md` (145KB PNG mislabeled as .md). None reached GitHub upstream (still at 0fa6f7b).
- **infra-verifier fixes**: two browser-test scripts no longer hardcode the preview hostname as TEST_BASE_URL fallback (now required env).
- Commit also carried the in-flight agent progress-stream WIP (progressStream.js + tests, redisEvents changes, authMemoryQuota.test.js) that had been sitting uncommitted.

Test suite: 497 tests, 488 pass, 9 skipped (legit feature-detection), 0 fail. infra_verifier: all-PASS after the two script fixes.

Corruption workarounds used: missing blob 2af68c1 (sync-team-branches.md) rebuilt via `git hash-object -w` (disk content hashed identically); garbage `.git/refs/heads/LIVE|MANOJ` + `refs/remotes/origin/LIVE` removed (remote intact); `refs/remotes/origin/MANOJ` is a fused directory inode — `git fetch` still broken locally until fsck/re-clone, but push + ls-remote work.

All six team branches (main, DEV, PUSHKAR, NIHARIKA, LIVE, MANOJ) fast-forwarded to 1be3796 on the managed origin, no force, per #10885 convention.