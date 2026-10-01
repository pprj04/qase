# Infra verification — Phase 7 React UI cutover (commit 58ed7a7)

Date: 2026-09-30. Scope: deployment readiness of the legacy-UI removal / React-at-root cutover.

- **Env**: backend env_keys (21 keys, all /workspace/.env) match container file exactly, key-for-key, values included. No stray materialized env files (.env.example is a placeholder template only — no real secrets).
- **Hardcoded secrets/URLs**: none in src/server/scripts. Preview-host/DB-cred hits exist only under /workspace/.drytis/memory/ (documentation, not served source).
- **Services**: qase-server (bg-service-4182) runs `exec node server/index.js`, binds 0.0.0.0:5173. procmgr all RUNNING; no dev-mode processes (ps scan clean).
- **Caddy**: root reverse_proxy → 5173, correct, single root proxy present.
- **Preview**: https://qase-2-1-jywqe4.drytis.dev/ → 200, title `QASE — new UI`, React bundle + CSS + theme-bootstrap all 200. /app-react/ also 200.
- **Setup script**: `npm ci` + `npm run build:react` + build-output hard check (exit 1 if public/app-react/index.html missing) + Chromium apt deps + `npx playwright install` + hard ldd verification (exit 1 on missing libs / missing binary) + conditional `npm run db:migrate` (Postgres only; local store skips). Minor: apt-get failure itself only WARNs, but the downstream chromium ldd check converts it to a hard failure — acceptable.
- **Migrations**: schema SQL lives only in server/postgres/migrations/ (plus controlPlane migrations module). No raw ALTER/CREATE TABLE outside migrations infra.

RESULT: PASS (0 failures, 0 new warns).
