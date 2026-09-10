# .git metadata corruption — 2026-09-02 (post R1 acceptance run)

## Incident
Immediately after the R1 A–E acceptance run (~21:40 UTC Sep 2), `git status` failed:
- `error: bad signature 0x32762f69 / fatal: index file corrupt`
- `refs/heads/main` contained `0000000000000000000000000000000000000000`-style garbage
- `git rev-parse HEAD` → "unknown revision"

## Root cause (ext4 cross-file corruption, same class as tests/ + .gitconfig damage)
- `.git/refs/heads/main` had been OVERWRITTEN with a fragment of `artifacts/test-report.json` (content: `i/v2/zzz-bound-probe-233...`).
- `.git/index` started with `i/v2` (`0x32762f69`) — same file fragment.
- Commit objects, reflog, and working tree were INTACT.

## Repair (verified)
1. True SHA recovered from `.git/logs/HEAD` (reflog intact): `47be7234ba3226d96260395dfb77b5ea13dd494a` (R1 commit).
2. `echo <sha> > .git/refs/heads/main`
3. `rm -f .git/index && git read-tree HEAD`
4. `git fsck --no-dangling` → clean; `git log` → HEAD=47be723; tree state matches pre-corruption exactly.

## Lessons
- Reflog is the recovery source for ref corruption — it survived because it's append-only.
- The index is a rebuildable cache (`read-tree HEAD`); never panic-delete the repo.
- This container's ext4 corruption has now hit: `tests/` dir entries, `docs/phase-3-knowledge-audit.md`, `.gitconfig` (GIT_CONFIG_GLOBAL=/dev/null workaround), and `.git/refs+index`. Before ANY commit/push on this box, run `git fsck --no-dangling` + `git log --oneline -1` and expect to repair refs from the reflog if needed.
- The corrupted ref content traced to `artifacts/test-report.json` — test artifacts are landing ON the same filesystem areas git metadata lives; keep commits small and frequent (protective commits already proven necessary twice).

## Result of the run that preceded it (R1 acceptance, user scenarios A–E): 5/5 PASS
A queued→stop→restart: cancelled survives restart, never executed (sessionId never assigned; disk row cancelled).
B created→stop: 200 cancelled/created, persisted.
C running→stop: 200 aborted; session settled idle; chromium procs 8→8; terminal.
D forced timeout (QASE_MISSION_TIMEOUT_MIN=5 — governor clamps to a 5-min floor, missionGovernor.js:65; model served by a trickle endpoint so only the governor could end it): failed in ~331s, failureReason='execution_timeout: exceeded the 5-minute wall clock', evidence endpoint 200, stable failed.
E runtime-start race: probeSession settled=false during pendingRuntimeKick on the live module (governor cannot finalize), true after kick clears; startTurn terminal guard pinned by suite; no scenario ever flipped terminal→running.
R1 suites re-run post-acceptance: 17/17.
