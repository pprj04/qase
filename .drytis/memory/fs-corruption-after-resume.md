# Block-level file corruption after container resume (recurring)

**Symptoms:** after a container pause/resume, inodes become unreadable at the
FS level. `stat` → "Structure needs cleaning" / "Bad message", `ls` shows
`-?????????`, reads fail with EIO / "Unknown system error -117". The damaged
inode cannot be deleted, truncated, unlinked, or renamed directly.

**History:** #10626 (runResume.js), #10636 (source files), #10900
(.qase/auth.json → server crash-loop → preview 502), damaged runsnapshot
(2026-09-14), #11203 (2026-09-16 — entire server/ dir [169 files] +
.drytis/specs/ + .qase/{auth.json,sessions.json,workspaces,runsnapshots}),
#11205 (2026-09-16 — corruption had ALSO eaten parts of `.git` itself:
binary-garbage .gitignore, fused origin/MANOJ ref dir, damaged NIHARIKA
reflog, unreadable pack .idx, fused userDocs image).

**Fix pattern (proven):**
1. Quarantine by rebuilding the PARENT dir: `mv <dir> <dir>.corrupt-<date>`
   (same-filesystem only!), `mkdir <dir>`, then `cp -r` each healthy entry
   back (cp fails on fused inodes — those stay behind in quarantine).
   Plain rm/mv on the damaged child does nothing.
2. Git-tracked files (server/, .drytis/specs/, .gitignore): recreate dir +
   `git checkout -- <path>` restores from HEAD. A binary-garbage working
   file is corruption residue, not an edit — diff renders as "Binary files
   differ" on a text file.
3. Runtime data (.qase/): boot with fresh store; re-seed accounts via POST
   /api/auth/register, verify login, refresh .drytis/cred.json.

**.git internals repair (#11205):**
- Fused ref dir (origin/MANOJ was a DIRECTORY with zero valid content):
  rebuild refs/remotes/origin via same-FS parent rename; copy healthy ref
  files back. NOTE: mv across filesystems (/tmp) half-fails on fused dirs —
  keep quarantine on the same FS.
- Unreadable pack .idx but healthy .pack: `git index-pack <pack>.pack`
  regenerates the idx. Then `git fsck --full` to confirm.
- Damaged reflogs: rebuild .git/logs/refs/heads, copy healthy files.
- Park all git quarantine under `.git/quarantine-corrupt/` — anything left
  under refs/ or logs/ is still scanned and breaks fsck/for-each-ref.
- Symptom that .git is wounded: `git log --all` → "fatal: bad object
  refs/remotes/origin/X", fsck → "invalid sha1 pointer 0000...".

**Stability verdict (2026-09-16, #11205):** walked all 36 commits; HEAD
78468f9 verified stable — `npm test` = 505 tests / 496 pass / 0 fail / 9
skipped; server boots; preview 200. The crash-loop after resume was FS
corruption, NOT a regression — no commit rollback was needed.

**Operational notes:**
- Corrupted preview 502 / crash-loop → `procmgr status` + tail
  `/var/log/services/service-bg-service-4182.log` FIRST; then `git status`
  (restore-from-HEAD is fast and complete for tracked files).
- `.gitignore` now ignores `*.corrupt-*/` quarantine dirs at root.