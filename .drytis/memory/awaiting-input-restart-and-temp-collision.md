# Restart-safe approval waits and atomic persistence

## Incident

A run that correctly asked for authorization entered `awaiting_input`. The
keepalive later went quiet, the container paused/restarted, and both
local/PostgreSQL recovery rewrote the wait to `interrupted` while deleting
`pendingQuestion`. The UI therefore showed an interruption instead of an
answerable approval request.

A second live issue amplified this: local atomic persistence used the fixed
temp path `sessions.json.tmp-<pid>`. A stale/corrupted directory at that path
caused repeated `EISDIR`, so session state stopped persisting.

## Fix

- Preserve `awaiting_input` and `pendingQuestion` across restart; only actively
  `running` sessions become interrupted and enter bounded auto-resume.
- Reconcile orphan `running` activities and clear process-local vault names in
  both local and PostgreSQL stores.
- When rebuilding a runtime for a waiting session, restore its saved SDK
  snapshot. If the SDK pending-question handle cannot be restored, convert the
  user's answer into an explicit recovery task containing the prior question.
- Atomic session writes use `sessions.json.tmp-<pid>-<uuid>` with best-effort
  cleanup, so stale PID paths cannot disable persistence.

## Verification

Focused local/PostgreSQL/runtime tests passed. Full suite: 480 tests, 471 pass,
0 fail, 9 skipped. Managed service and Caddy are green; local/public health are
200; live keepalive reaches the edge; current sessions JSON is valid and
recently updated; no post-restart `EISDIR` errors.
