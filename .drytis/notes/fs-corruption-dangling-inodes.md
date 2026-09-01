# Container FS corruption — dangling inodes (Aug 21, 2026; updated Sep 1, 2026)

Corrupt dentries return `Structure needs cleaning` (ext4 deleted-inode-referenced
entries, cannot stat/rm/cat from inside the live mount; needs fsck on unmounted
fs — not possible in-container; even root can't clear them: unlink/rename/recreate
all fail with EUCLEN and /proc/sys/vm/drop_caches is read-only).

**As of Sep 1, 2026 — THREE corruption clusters:**

1. `/home/coder/.gitconfig` — FIXED Sep 1 (rewritten with valid identity config).
   Was bypassed via `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null`.
2. `/workspace/.drytis/specs/build3-findings-ux.md` — directory entry points to a
   deleted inode. Do not reference that filename; use a different name
   (e.g. `build4-final-demo-polish.md`). Writing OTHER files in specs/ works.
3. **NEW Sep 1: `/workspace/package.json` and `/workspace/package-lock.json`** —
   both corrupt (hit during git index rebuild; dmesg `ext4_lookup: deleted inode
   referenced`). Consequences + workarounds:
   - `node server/index.js` — WORKS: `server/package.json` (`{"type":"module"}`,
     committed e636180) makes Node resolve module type from the NEAREST
     package.json; the corrupt root file is never read. DO NOT REMOVE.
   - `npm <anything>` at /workspace — BROKEN (`ERR_INVALID_ARG_TYPE`), because
     npm itself stats package.json. All npm scripts (start/test*/install-browser)
     are dead at the repo root. Run the server directly: `node server/index.js`;
     run tests via `node --test tests-real/<file>.test.js` (export
     `QASE_API_TOKEN` first — see below); install deps via the setup script's
     git-archive fallback or `git archive HEAD | tar -x -C /tmp/clean && npm
     install` in the clean copy, then copy node_modules back.
   - `git status`/commit will forever show the two paths as broken-looking
     noise ("Structure needs cleaning") — harmless; git's object store is intact
     (`git show HEAD:package.json` works and is the source of truth).
   - Also same class: `userDocs/image_54799931.png`, and
     `.qase/workspaces/95fdbfdc…` ("Bad message").
4. Real fix = platform-side fsck / volume recreation. Until then the workarounds
   above are load-bearing.

Root cause: container pauses during IO (same class as the phase16/phase18
corruption incidents in phase16-env-corruption-incident.md /
phase18-executor-corruption-incident.md). Everything else on the volume is
healthy (writes succeed, git object store intact).

## Test-runner note (Sep 1)
Live-server tests read `QASE_API_TOKEN` from the environment (NOT .env, and NOT
`QASE_BASE_URL` which means the LLM gateway URL in this app): run them as
`source <(grep -E '^QASE_API_TOKEN=' /workspace/.env) && export QASE_API_TOKEN &&
node --test tests-real/<file>.test.js`. b0-restart-config.test.js now
distinguishes "unauthenticated 401" (needs token) from "server down" in its
skip reason.
