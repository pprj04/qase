# ENOSPC incident — 2026-09-09 — root cause: ext4 corruption + shared volume

## Symptom
Qase agent runtime failed: `ENOSPC: no space left on device, mkdir /workspace/.qase/workspaces/<uuid>`.

## Root causes (two)
1. **ext4 filesystem corruption on /dev/nvme0n1** (~9.8G volume). `dmesg` shows 222+
   `EXT4-fs error ... deleted inode referenced` / `Structure needs cleaning` / `Bad message`.
   Corrupted dirs (rm fails with "Structure needs cleaning"): `/workspace/.qase-old-corrupted`,
   `/workspace/.corrupt-husk-aws`, `/workspace/tests`, `/home/coder/.gitconfig` (some git
   profiles are .bak now), `/home/coder/.cache/ms-playwright.broken` (leftover ~28K husk).
   **Phantom usage**: visible files ≈ 2.3G but df reports ~8.6G used — ~6G of used blocks are
   orphaned/unaccounted. Only fsck from host (unmounted) can reclaim + repair. A container
   restart will NOT fix this.
2. **Same physical device hosts several mounts**: `/workspace`, `/var/lib/mysql` (mysql-data),
   `/home/coder` (user-data), `/var/logs` — all share one 9.8G pool. Big space consumers that
   LOOK like they're elsewhere actually eat the workspace volume: `/home/coder/.cache`,
   `/home/coder/.drytis/agents`, `/home/coder/.npm`.

## What was moved to /tmp (separate 388G virtiofs root fs — NOTE: /tmp is NOT persisted across container restarts)
- Playwright browsers → symlink `/home/coder/.cache/ms-playwright` → `/tmp/pw-cache/ms-playwright` (works, chrome verified)
- codex-acp agent node_modules → symlink `/home/coder/.drytis/agents/codex-acp` → `/tmp/ag/codex-acp` (codex-cli 0.153.4 verified)

**If ENOSPC returns after a container restart, re-create those two moves first** (contents will
be gone from /tmp): browsers via `npx playwright install chromium` (auto to /home/coder/.cache —
then move+symlink), codex-acp via reinstalling its node_modules.

## What was deleted safely (2026-09-09)
- /workspace/tmp/qase-compare (189M), qase.zip (63M), qase-share.zip (4M), ~20 stray *.png at repo root
- /home/coder/qase-release/node_modules (163M), /home/coder/.cache/ms-playwright-mcp (109M, partially corrupt)
- /home/coder/.codex/plugins + cache (50M), /home/coder/.drytis snapshot dirs
- /workspace/.qase-test-scratch, handoff-test

## Result
0 free → ~745M free (93%). Agent workspace mkdir OK, preview URL 200.

## Follow-up for the USER/support
- Ask for a volume fsck/repair from host side (or volume replacement) — corruption persists and
  can resurface. Cannot fsck from inside container.

## MySQL note
`procmgr status` shows mysql STOPPED (was stopped during incident too — possibly casualty of
corruption/full disk). Qase uses JSON file storage in /workspace/.qase, so the app serves fine,
but anything needing MySQL will fail until `procmgr start mysql`.
