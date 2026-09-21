# 2026-09-17 release attempt to qase.drytis.com (ticket #11554)

- Released HEAD 78468f9 (main) to deployment #153 via update_production_config → restart_production → redeploy ×3.
- Pod fully verified after each restart: correct commit, procmgr green, /healthz ok, /readyz ready, Host-header curl → app 200, /api/health auth-gated, .env with LLM keys materialized. NOTE: pod Caddy serves ONLY the named site `http://qase.drytis.com` (Host-header match) — the *.drytis.dev direct URL (prod-qase-2-1-tawpkk.drytis.dev) 404s at root by design because no named block exists for it; /healthz works everywhere.
- Edge STILL broken and it is NOT this project's code: https://qase.drytis.com → TLS alert internal error (no cert served, SNI probes fail); http:// → 302 https://drytis.com. custom_domains row = [] after every flow (again: update config, restart, redeploy ×3 incl. explicit domains, per earlier full-teardown attempts in prod-deploy-flow.md).
- Same platform defect as #10927/#10964: tls-edge never writes the custom-domain route. Do NOT re-run deploys to "fix" this — it does not. Verify after any platform fix with: https://qase.drytis.com/api/health → 200 auth-gated JSON (not incumbent fingerprint), root 200.
- Everything pod-side is release-ready; only the platform route registration is pending.
