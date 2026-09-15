# Block-level file corruption after container resume (recurring)

**Symptoms:** after a container pause/resume, files in `.qase/` become
unreadable at the FS level. `stat` → "Structure needs cleaning", `ls` shows
`-?????????`, reads/writes fail with "Bad message" / "Unknown system error
-117" / EIO. Crucially, **the damaged inode cannot be deleted, truncated,
unlinked, or renamed directly** — plain `rm`/`mv` on the file does nothing.

**History:** #10626 (runResume.js), #10636 (source files), #10900
(.qase/auth.json → server crash-loop → preview 502), plus a damaged run
snapshot in `.qase/runsnapshots/` the same day.

**Fix patterns:**
1. *App level* — `loadData()` in `server/auth.js` now quarantines any
   non-ENOENT / non-JSON auth store (rename best-effort + console.warn) and
   boots with a fresh store instead of throwing. Regression tests in
   `server/auth.test.js`. Snapshot readers in `agent.js` were already
   try/catch-guarded.
2. *Data recovery* — to reclaim a damaged inode, rebuild its PARENT directory:
   `mv <dir> <dir>.corrupt-<date>` (renaming the parent works even when the
   child inode is fused), `mkdir <dir>`, then `mv` each healthy entry back.
   The damaged entry stays behind in the quarantine folder.

**Operational notes:**
- After any auth-store loss, accounts must be re-seeded and
  `.drytis/cred.json` refreshed with fresh `verified_at`.
- Corrupted preview 502 → check `procmgr status` + tail
  `/var/log/services/service-bg-service-4182.log` FIRST.
- Quarantines kept at `/workspace/.qase.corrupt-*` for forensics; `.qase/` is
  gitignored, so this is runtime data, not repo content.
