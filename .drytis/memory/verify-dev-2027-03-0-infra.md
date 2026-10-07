# Infra verification after DEV catalog 2027.03.0 change (2026-10-05)

Full 7-section audit: RESULT PASS (0 FAIL, 3 WARN). Preview 200 at / and /healthz, serving QASE app. qase-server (bg 4182) RUNNING via procmgr, prod command `exec node server/index.js`, no dev processes. Caddy root → 5173, confirmed bound (127.0.0.1:5173 ok). Env keys 21/21 match /workspace/.env, no extras.

WARNs carried:
1. **DEV change NOT published**: catalog 2027.03.0 + migration 030_environment_profile_id.sql exist only as UNCOMMITTED working-tree state on NIHARIKA (`git status` M/??). origin/DEV HEAD f04f78d contains neither. A fresh deploy/pod recreation from origin/DEV will silently run 2027.02.0 with no migration. git_manager's "UP TO DATE" only checked incoming, not outgoing. Commit+publish required.
2. **Stale literal preview host in env key 50925** (QASE_BROWSER_ALLOWED_PRIVATE_HOSTS = `qase-2-1-jywqe4...`) — current preview is cvtryq; known since dx-phase1 (see that note). Should be re-set with the current host or removed.
3. Container has known fs-corruption dirs (`.corrupt-*`, `node_modules.broken`) — grep noise only, see fs-corruption-after-resume.md. Use `git grep` for source scans here.

Server restarted recently at audit time (uptime ~1 min) — expected, it was serving 200 immediately.
