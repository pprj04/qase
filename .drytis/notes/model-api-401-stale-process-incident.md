# Model API 401 incident (2026-09-01) — stale server process after main-branch fetch

## Symptom
User saw red toast: "Invalid or missing API token. Set Authorization: Bearer <token> header."
during a studio.drytis.ai run. Assumed to be "model API not working".

## Root cause
NOT the model API — the LLM gateway (llm.drytis.ai/v1) was healthy the whole time.
The qase-server-v2 background service process had started (14:16:40 UTC) BEFORE the
main-branch fetch (~14:18 UTC) landed D0.5 scoped UI access codes. Express.static
served the NEW public/ UI from disk while the Node process still ran OLD pre-D0.5
code. The new UI's login flow POSTs /api/auth/session — a route that didn't exist in
the old process → fell through to the master-token gate → the exact 401 toast.

## Diagnostic tell
`curl -X POST /api/auth/session -d '{"accessCode":"x"}'` returned the MASTER-TOKEN
error text instead of the handler's own `{"error":"Invalid access code."}`. Any time
a known route returns the requireApiToken fall-through text, suspect a stale process
(process start time predates latest commit — check `ps -o pid,lstart` vs `git log`).

## Fix
`npm install` (new ws dep) → `procmgr restart service-bg-service-3962`. Verify: bad-code
login returns its own error; mint→login→whoami 200s; a live agent turn replies.

## Related hazards (see also restart-wipes-uncommitted-work.md)
1. Container restart wipes uncommitted work — commit before restarts.
2. After any fetch/update of the repo, RESTART the background services so the
   process matches the code on disk. Node does not hot-reload.
3. /home/coder/.gitconfig was found corrupted (binary garbage) — repaired with
   user identity + init.defaultBranch=main. If git fails with "bad config line 1",
   check that file; GIT_CONFIG_GLOBAL=/dev/null bypasses non-destructively.

## Follow-up (optional)
- Boot 401s for anonymous visitors now log via console.info ("needs sign-in") — done.
- .qase/ui-access.json accumulates test-minted codes (26 active of 30) — test suites
  mint without revoking; consider pruning old d05-* codes periodically.
