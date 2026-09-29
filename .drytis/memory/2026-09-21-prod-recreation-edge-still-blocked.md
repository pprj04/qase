# 2026-09-21 production recreation at qase.drytis.com (ticket #12246)

User asked to delete existing production and redeploy at qase.drytis.com, keeping data (keep_volume=true).

## What was done
- git_manager published 11 uncommitted files as 3 commits to origin/LIVE (cc707eb..a8b271b).
- stop_production(keep_volume=true) → deploy_to_production FAILED with backend 500 (stale deployment #153 record blocks fresh creation; reproducible across stops/waits/retries — same-day persistent).
- redeploy_production works as fallback recreation: new pod each time (volume persisted), but does NOT fix TLS route (see below).
- FIXED REAL BUG: project repo config deployed branch `main` (stale @78468f9) while all work ships on `LIVE`. update_repository(3605, branch=LIVE) + manual checkout in prod pod → now LIVE @a8b271b, npm ci done, qase-server restarted (procmgr name is `service-bg-service-4182` — `prod_restart_service('service-bg-*')` works).
- Persistent volume keeps the old checkout branch across pod recreation; drytis-init only pulls, doesn't switch branches. After any branch change, the prod pod must be manually switched (`git fetch && git checkout LIVE && git pull`) or the volume wiped.

## Still broken (platform defect — do NOT re-deploy to fix)
- https://qase.drytis.com → TLS alert internal error; http:// → 302. `list_production_custom_domains` = [] after every flow. Same tls-edge custom-domain route registration defect as 2026-09-17 (see 2026-09-17-release-edge-blocked.md, tickets #10927/#10964).
- deploy_to_production keeps returning 500 while deployment record #153 exists in stopped/running state — fresh first-time deploys for this project are not possible without backend-side cleanup of record 153.

## Verify after platform fix
https://qase.drytis.com/ → 200, /api/health → 200 auth-gated.