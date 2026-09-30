# Production deploy state — updated 2026-09-25 (#12954)

Supersedes the "still blocked" conclusions of 2026-09-17/09-21 notes for routing.

## Verified end state (all checked 2026-09-25)
- https://qase.drytis.com/ → 200 over HTTPS; /healthz → 200.
- Prod pod branch: **PUSHKAR @ a8b271b** (repo config updated to branch PUSHKAR via update_repository id 3605).
- Restart drill PASSED: update_production_config → restart_production → new pod (IP 10.2.145.110), volume persisted, branch stayed PUSHKAR after drytis-init pull, HTTPS still 200.
- procmgr service name in prod: `service-bg-service-4182` (prod_restart_service 'service-bg-*' works).

## Residual knowns
- `list_production_custom_domains` still shows status "pending" with `Cloudflare API: Duplicate custom hostname found` — orphaned CF entry from an earlier deploy. **Benign**: routing + TLS work (full handshake, 200s). Do not attempt to fix by re-adding; add_production_custom_domain is what activated the route on 2026-09-21.
- `deploy_to_production` still 500s while deployment record #153 exists. Working combo for recreation: `redeploy_production` + manual branch verify. For routine code pushes use: git gate → update_production_config → restart_production (verified working).
- Persistent volume keeps checkout branch across pod recreation — ALWAYS verify `git branch --show-current` in the prod pod after any restart; switch manually if drifted.

## Deploy runbook (code push)
1. git_manager pre-deploy gate on PUSHKAR (dev container).
2. Build/migrate checks on dev (npm run verify).
3. update_production_config(3542).
4. restart_production(3542).
5. Verify: get_production_status healthy; prod_run_bash git branch/HEAD; curl https://qase.drytis.com/ + /healthz → 200.
