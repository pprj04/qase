# Task: Fix 502 Bad Gateway on project preview (ticket #10900)

## Goal
The preview URL returned 502 because the Qase server crash-looped on boot: the
local authentication store `.qase/auth.json` became unreadable at the
filesystem level after a container pause/resume ("Structure needs cleaning" /
error -117 / "Bad message" on stat). The damage also blocked every
write/rename/unlink aimed at the file itself, so plain deletion was impossible.

## Diagnosis
- `procmgr status` → `service-bg-service-4182 STOPPED`; service log showed
  `Error: The local authentication store is unreadable.` on every start.
- `stat`/`cat` on `/workspace/.qase/auth.json` failed with "Structure needs
  cleaning"; even `mv`/`rm`/`truncate` on the file failed with error -117.
- Same failure class as tickets #10626/#10636 (block-level corruption after
  container resume). A second damaged inode existed in `.qase/runsnapshots/`.

## Changes
1. `server/auth.js` — `loadData()` no longer crashes on a non-ENOENT read
   failure. It quarantines the damaged store (rename attempts to move the
   directory entry; harmless if the damaged directory also refuses the rename)
   and boots with a fresh in-memory store. A torn/non-JSON store is quarantined
   the same way instead of crashing.
2. `server/auth.test.js` — two regression tests:
   - unreadable store (EISDIR stands in for the damaged-inode case) → boots,
     registers, quarantines `auth.json.unreadable-*`, store persists;
   - corrupt JSON store → quarantined, fresh store created.
3. Data recovery: rebuilt `/workspace/.qase` around the damaged inode and
   restored every healthy artifact (`auth.json.key`, `sessions.json`,
   `runsnapshots/*.json`, `workspaces/`); quarantined remnants live in
   `/workspace/.qase.corrupt-20260914/`.

## Acceptance criteria
- [x] Service starts and stays up (`procmgr status` → RUNNING, no restart loop)
- [x] `curl http://127.0.0.1:5173/` → 200; preview URL → 200
- [x] Register → 201 persists; after service restart, login → 200
      (recovery-check@qase.dev used for the proof)
- [x] Full unit suite green: 380 tests, 373 pass, 0 fail, 7 skipped
- [x] New regression tests pass (7/7 in `auth.test.js`)
- [x] Re-seeded dashboard accounts verified working (see `.drytis/cred.json`)

## Known impact
The destroyed store held the user accounts and their encrypted settings.
Accounts were re-created; per-user Settings (custom gateway key) must be
re-entered once. Runs history in `.qase/sessions.json` was preserved.
