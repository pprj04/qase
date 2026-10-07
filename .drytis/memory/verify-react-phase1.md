# Infra verification — React UI Phase 1 (ticket #14023), 2026-09

Read-only audit after Phase 1 React rebuild. RESULT: PASS (no failures, 3 WARNs).

- Backend env_keys (21, all in /workspace/.env) match container .env exactly by key; QASE_API_KEY/QASE_METRICS_TOKEN resolve correctly. No DB_* keys either side (QASE_RUN_STORE=local, JSON store).
- No hardcoded secrets/preview URLs in project source (server/, src/, public/, scripts/, configs). Hits only in runtime state (.qase/sessions.json, .drytis/) — not deployable source.
- Service qase-server (id 4182) runs `exec node server/index.js`, production. procmgr: all running. No dev processes (`vite`/`npm run dev` absent from ps).
- Preview: `/` 200 legacy UI unchanged ("Qase — autonomous QA agent", styles.css etc.); `/app-react/` 200 React shell (theme bootstrap, /app-react/assets/* JS+CSS 200). vite base='/app-react/' matches server/app.js:186 route.
- Setup script: npm ci + npm run build:react + hard check public/app-react/index.html + conditional db:migrate (postgres-only; local store skips, documented). Migrations all under server/postgres/migrations/*.sql.

WARNs reported (not fixed):
1. public/app-react/ is untracked AND not in .gitignore (`?? public/app-react/`) — risk of committing build output; add to .gitignore.
2. QASE_METRICS_TOKEN uses tag=static with a literal 64-hex secret default — won't travel across user/scope contexts.
3. /workspace/.env.example exists without a backing backend env_key (template file, documentation-only — informational).

Known container quirks unchanged from memory: shallow-clone fetch quirk (git-fetch-quirk-shallow-clone.md), fs-corruption dirs (.qase.corrupt-*, node_modules.broken, server.corrupt-*) still present and grep-noisy but excluded from source scans.
