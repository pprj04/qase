# TLS edge blocker RESOLVED — HTTPS live at qase.drytis.com (2026-09-21, 21:10 UTC)

Supersedes 2026-09-17-release-edge-blocked.md and 2026-09-21-prod-recreation-edge-still-blocked.md.

## The fix
The deploy/redeploy flows never register the custom-domain route (custom_domains stayed []). `add_production_custom_domain(project_id, domain)` DID — it's the registration lever that works. It returned `Cloudflare API: Duplicate custom hostname found` (orphaned CF entry from an earlier deploy) with status "pending", but the route still became active: within ~60s of the call, https://qase.drytis.com/ served a full TLS 1.3 handshake and 200. The "duplicate" error is apparently benign.

## Verified end state
- https://qase.drytis.com/ → 200, real Qase app HTML ("Qase — autonomous QA agent").
- /api/health → 401 (correctly auth-gated per app design).
- Pod: branch LIVE @a8b271b, qase-server (procmgr: service-bg-service-4182) running, local :5173 → 200.
- Repo deploys from branch LIVE (fixed 2026-09-21; was stale main).

## Reminders
- Persistent volume keeps the old branch across pod recreation; after any deploy, verify `git rev-parse --abbrev-ref HEAD` in the prod pod and manually switch to LIVE if drytis-init didn't.
- deploy_to_production keeps 500-ing while deployment record #153 exists; redeploy_production + add_production_custom_domain is the working recreation combo.