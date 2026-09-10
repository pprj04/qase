# Container FS corruption — dangling inodes (Aug 21, 2026)

Two paths return `Structure needs cleaning` (ext4 deleted-inode-referenced
entries, cannot stat/rm/cat from inside the live mount; needs fsck on unmounted
fs — not possible in-container):

1. `/home/coder/.gitconfig` — bypass with `GIT_CONFIG_GLOBAL=/dev/null
   GIT_CONFIG_SYSTEM=/dev/null` on every git command. Do NOT try to rm/fix it.
2. `/workspace/.drytis/specs/build3-findings-ux.md` — directory entry points to
   a deleted inode. Do not reference that filename; use a different name
   (e.g. `build4-final-demo-polish.md`). Writing OTHER files in specs/ works.

Everything else on the volume is healthy (df 40%, writes succeed, git works
with the env-var bypass). Parent dirs list fine. Root cause: container pauses
during IO (same class as the phase16/phase18 corruption incidents in
phase16-env-corruption-incident.md / phase18-executor-corruption-incident.md).
