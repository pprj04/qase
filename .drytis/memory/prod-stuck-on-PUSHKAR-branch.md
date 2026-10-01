# Production deployment was stuck on PUSHKAR branch (fixed 2026-09-30)

Symptom: user reported the stage expand/collapse feature "not in this version" at
qase.drytis.com, but the preview (qase-2-1-jywqe4.drytis.dev) served it fine and all
work had been published to DEV.

Root cause: the project's repository config (repo id 3605) had `branch: PUSHKAR` —
set back when #12458 created the team branches. Production's drytis-init pulls the
configured branch on boot, so every restart served PUSHKAR's tip (Sep 21 code, a8b271b).
Meanwhile all recent work went to DEV. The gap silently widened for ~9 days.

Fix sequence that worked:
1. `update_repository` → branch DEV.
2. `update_production_config` + `restart_production`.
3. IMPORTANT: the restart reused the persistent volume's existing PUSHKAR checkout —
   changing the backend config does NOT re-clone or switch an existing checkout.
4. `prod_run_bash`: `git fetch origin DEV && git checkout DEV && git reset --hard origin/DEV`,
   then `npm ci`, then `procmgr restart service-bg-service-4182`.
5. Verified: /app.js served with renderStageCollapse present (Last-Modified today).

## Invariant for future deploys
- Before restarting production for a code push, run `get_project_details` and confirm
  `repositories[0].branch` is the branch your work is on (DEV).
- After ANY `restart_production`, verify prod actually serves the new code:
  `curl -sI http://qase.drytis.com/app.js | grep Last-Modified` and grep a known-new
  symbol. A 200 + healthy pod is NOT proof — the volume may hold an old checkout.
- If the checkout is stale on the right config, switch it in-container via prod_run_bash
  (fetch + checkout + reset --hard + npm ci + procmgr restart).

Note: LIVE branch also exists and used to be the deploy target; PUSHKAR/LIVE tips were
equal at the time of the fix. Keep releases flowing through DEV now.
