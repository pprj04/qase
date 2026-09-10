# Spec: Phase 2 · Stand up and run the Qase server

## Goal
Run the Qase app (cloned in Phase 1) as a production background service inside the workspace container, reachable via the preview URL, with the LLM gateway configured so the agent can actually execute test runs.

## Context
- Repo: /workspace, Node ESM project ("qase" v0.1.0), entry `server/index.js`, default PORT 5173.
- Deps (6): @cleanslate.sdk, express 5, playwright 1.62, pg, redis, dotenv.
- Default store: local JSON (`QASE_RUN_STORE=local`) — no DB required.
- LLM: OpenAI-compatible gateway via `QASE_API_KEY` / `QASE_BASE_URL` / `QASE_MODEL`. Mint via create_openai_api_key and persist as env keys (NEVER hardcode).
- .env.example lists many optional knobs; only set what's required to boot.

## Changes
1. `npm ci` in /workspace (deps + playwright browser install via `npm run install-browser` if needed).
2. Env keys (bulk_add) → /workspace/.env: PORT=5173, QASE_RUN_STORE=local, QASE_API_KEY (secret, minted), QASE_BASE_URL, QASE_MODEL, QASE_HOST=0.0.0.0 (must bind non-loopback for Caddy), QASE_AUTH_REQUIRED=true (app default; demo creds in repo README for login).
3. Background service (production command): `node server/index.js` in /workspace.
4. Caddy proxy: reverse_proxy / → 127.0.0.1:5173.
5. Setup script: npm ci + install-browser, kept current for deploys.

## Acceptance criteria
- [ ] `procmgr status` shows the qase service running
- [ ] `curl -sf http://localhost:5173/` returns 200 from the production service (no dev processes)
- [ ] Preview URL serves the Qase dashboard
- [ ] QASE_API_KEY/QASE_BASE_URL set via backend env keys (secret), not in source
- [ ] infra_verifier reports PASS
- [ ] reviewer + tester report PASS on dashboard load and login with demo credentials (if login required)

## Out of scope
- Postgres/Redis distributed mode, control plane, worker, k8s deploy.
