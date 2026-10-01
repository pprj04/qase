# /workspace/.env empty-virtiofs bug + working service workaround (2026-09-25)

## Symptom
UI shows "No API key set" / config endpoint `hasApiKey:false`. Cause: `/workspace/.env` is a **virtiofs bind of /drytis-config/environments/b90ad02700c6.env** whose backing share is NOT visible inside the container (`/local/drytis-config` does not exist here) — every read of /workspace/.env returns empty even though the backend's env rows are complete and the share copy (readable at /drytis-config/environments/*.env, 404 bytes) has all values. Same family as the boot-time .env truncation in prod-edge-502-continued. Cannot be unmounted (no CAP_SYS_ADMIN; sudo umount refused).

## Workaround (deployed 2026-09-25, background service 4182)
qase-server script now sources `/drytis-config/environments/*.env` explicitly before exec:
`cd /workspace && set -a && for f in /drytis-config/environments/*.env; do [ -f "$f" ] && . "$f"; done && set +a && exec node server/index.js`
Verified: process env has QASE_API_KEY, /api/config → hasApiKey:true, ready:true, provider:custom. dotenv/config in index.js stays as harmless fallback.

## Rules
- NEVER write /workspace/.env directly (besides being forbidden, it's a mount — writes vanish).
- Env changes go through backend env-key tools; then procmgr restart service-bg-service-4182 (script re-sources the share).
- If a future container gets a HEALTHY .env mount, the workaround is still correct (set -a sourcing is idempotent).
- Prod pod (qase.drytis.com) had the same class of bug in memory prod-edge-502-continued; if prod shows "No API key set", check its background service script sources the env share too — after pushing this service-script change via update_production_config.
