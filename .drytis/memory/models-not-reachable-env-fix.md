# "Models are not reachable" / empty .env — RECURRING flake (2026-09-23, #12776)

## Symptom
Settings dialog shows provider=anthropic / claude-oppus-5 defaults, "Cross-origin request rejected" error, or sidebar model badge shows "No API key set." Model list never loads.

## Root cause
`/workspace/.env` intermittently materializes as 0 bytes on container resume/boot. This has now happened TWICE (2026-09-23 ~21:52 and earlier the same day). The backend's env_keys rows (14 keys: QASE_API_KEY=sk-••••l8nw, QASE_BASE_URL=https://llm.drytis.ai, QASE_PROVIDER=custom, QASE_MODEL=z-ai/glm-5.2, etc.) are intact — only the materialized file is empty. Server falls back to DEFAULTS (anthropic, no key). The "cross-origin" text surfaces from failed API calls while the page races a restarting container; the badge text comes from `config.problem` via `el.modelBadge.textContent = config.ready ? config.model : (config.problem ?? 'not configured')` in public/app.js:3073.

## Fix (repeatable)
1. `wc -c /workspace/.env` — if 0, it's this flake.
2. `restart_container(3542)` → wait ~30s → verify .env is 404 bytes with `QASE_API_KEY=` present.
3. Verify: login via /api/auth/login (creds in /workspace/.drytis/cred.json), GET /api/config → hasApiKey true + apiKeyHint "••••l8nw"; POST /api/config/test with X-CSRF-Token from the qase_csrf cookie → "Reachable — 8 model(s) listed."
4. Tell the user to hard-refresh the page.

## Verified chain (round 2, 2026-09-23 22:00)
- GET /api/config → provider custom, baseUrl llm.drytis.ai, hasApiKey true, apiKeyHint ••••l8nw, apiKeyFromEnv true, ready true
- POST /api/config/test → ok, 8 models
- Browser tester 5/5 PASS: badge "z-ai/glm-5.2"; dialog provider "custom (OpenAI-compatible endpoint)" + preconfigured note; key field placeholder "••••l8nw — leave blank to keep"; Base URL VALUE https://llm.drytis.ai (placeholder only shown when empty); 8-model dropdown; Test connection green "Reachable — 8 model(s) listed."
- Pre-login 401 on /api/auth/me is expected (session probe), not an error.

## Note
If this recurs, FIRST check `wc -c .env` and restart the container before touching code. No app code writes .env; it is not git-tracked (.gitignore covers it). The flake is in the platform's env materialization on container boot — treat restart_container as the reliable re-trigger.