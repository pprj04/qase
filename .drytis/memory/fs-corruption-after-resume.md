# Block-level file corruption after container resume (recurring)

**Symptoms:** after a container pause/resume, inodes become unreadable at the
FS level. `stat` → "Structure needs cleaning" / "Bad message", `ls` shows
`-?????????`, reads fail with EIO / "Unknown system error -117". The damaged
inode cannot be deleted, truncated, unlinked, or renamed directly.

**History:** #10626 (runResume.js), #10636 (source files), #10900
(.qase/auth.json → server crash-loop → preview 502), damaged runsnapshot
(2026-09-14), **#11203 (2026-09-16 — worst yet: ENTIRE server/ dir [169 files]
+ .drytis/specs/ + .qase/{auth.json,sessions.json,workspaces,runsnapshots}
all fused; dmesg showed EXT4 dirblock-csum + block-bitmap corruption)**.

**Fix pattern (proven again in #11203):**
1. Quarantine by rebuilding the PARENT dir: `mv <dir> <dir>.corrupt-<date>`,
   `mkdir <dir>`, then `cp -r` each healthy entry back (cp fails on fused
   inodes — those stay behind in quarantine). Plain rm/mv on the damaged
   child does nothing, but renaming the parent works.
2. For git-tracked files (server/, .drytis/specs/): `git checkout -- <dir>`
   after recreating the dir restores everything from HEAD.
3. For runtime data (.qase/): boot with fresh store; app-level quarantine
   (auth.js loadData) accepts a missing store. Sessions/workspaces data in
   quarantine is likely unrecoverable — restart any in-flight runs.

**Post-recovery checklist (all done in #11203):**
- `git status` clean of D entries; only intentional M entries remain.
- `procmgr restart service-bg-service-4182` → RUNNING.
- curl localhost:5173 AND preview URL → 200.
- Auth-store loss: re-seed accounts via POST /api/auth/register
  ({"email","password","name"}), verify via /api/auth/login, then refresh
  `.drytis/cred.json` verified_at/verified_by.
- Quarantines at /workspace/server.corrupt-*, .qase.corrupt-*,
  .drytis/specs.corrupt-* for forensics; .qase/ is gitignored runtime data.

**Operational notes:**
- Corrupted preview 502 / crash-loop → `procmgr status` + tail
  `/var/log/services/service-bg-service-4182.log` FIRST.
- If server/ is wiped again, check `git status` before anything else —
  restore-from-HEAD is fast and complete.