QASE (project 2516) release preservation, 2026-09-09:

- /workspace ext4 (/dev/nvme0n1) corrupted: /workspace/tests dentries unreadable ("Structure needs cleaning"); fs at ~98% full. e2fsck must run unmounted — platform-level, NEVER from inside container.
- Clean RC created at /home/coder/release-qase from origin/main ec8d549 + 21 cherry-picked commits.
- Secret scan of tracked tree: CLEAN (only fixture/demo credentials in server/demoSite.js + tests).
- Preserved remotely (same repo as project origin):
  - release/qase-2026-09-09-rc = 52a4560 (RC, no unstaged files)
  - backup/qase-pending-tests-2026-09-09 = 72dbdbd (2 pending test edits: tests-real/c4-agent-browserstack.test.js, tests-real/p0f5-frame-recovery.test.js, +28/-2)
  - origin/main unchanged at ec8d549.
- After preservation, ALL WRITES to this filesystem stopped. Recovery plan: repair storage → clone RC branch into healthy workspace → apply/review the two pending tests (also in 72dbdbd) → full release validation there.
- Gotcha: run_bash with GIT_CONFIG_GLOBAL=/dev/null wipes git identity — commit fails "empty ident name". Project author: Pushkaraj Potdar <potdarpushkaraj04@gmail.com>; set via GIT_AUTHOR_NAME/EMAIL + GIT_COMMITTER_NAME/EMAIL env when committing.
- 2nd backup push note: first push of backup branch accidentally pushed base 52a4560 (failed commit), corrected by pushing 72dbdbd on top (normal push, no force).