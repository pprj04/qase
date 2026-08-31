# QASE — Troubleshooting

Verified causes only; symptoms verified against current code/runtime (2026-08-29).

## Server not starting

- **Symptom:** port silent / process exits.
- **Verify:** `procmgr status`; `tail -50 /var/log/services/qase-server-v2.log`; `node server/index.js` in a terminal for the live error.
- **Likely causes & fixes:** missing deps (`npm install`), missing Chromium (`npm run install-browser`), port in use (`PORT`), boot banner `config.problem` (Settings incomplete — not fatal, configure LLM), corrupted `.qase/*.json` store (the boot log names the file; `.qase/benchmarks`-style backups exist under `.drytis/backup-*` — NOT VERIFIED as restorable).

## API returns 401

- **Symptom:** `{"error":"Invalid or missing API token. Set Authorization: Bearer <token> header."}`
- **Cause:** `QASE_API_TOKEN` is set on the instance → everything under `/api` requires it (only `/api/health`, `/api/v2/health`, `/openapi.json`, `/demo` are public).
- **Verify:** `curl -s -o /dev/null -w '%{http_code}' http://localhost:5173/api/v2/health` → 200 (rules out outage).
- **Fix:** send `Authorization: Bearer <token>` (or `?token=` for EventSource). Token lives in the platform env record / `/workspace/.env`. A 401 on exactly one environment = that env has a different token.

## Shared run URL asks for a token

- **Symptom:** opening `#/runs/<id>` in a fresh browser shows the API-token gate.
- **Cause:** by design (B1). Runs are not public; the recipient pastes the instance token once (stored in localStorage). The cookie is never auto-granted.
- **Verify:** with the token, the URL loads and falls back to the first run if the deep-linked id was deleted.
- **Fix:** share the token out-of-band; nothing to repair. (Verified 2026-08-27 across 3 browser contexts.)

## Settings unavailable / gear button focuses token input

- **Symptom:** while the token gate is visible, Settings redirects to the token field.
- **Cause:** by design while unauthenticated. After successful auth (page reloads, gate gone), Settings opens normally.
- **Verify:** authenticate → click gear → dialog opens.
- **If Settings stays broken after auth:** check `/api/config` returns 200 with the token; check console for JS errors; report — this was previously suspected and did NOT reproduce (2026-08-27).

## BrowserStack authentication failure

- **Symptom:** Settings → Test BrowserStack Connection fails; or a BrowserStack replay errors.
- **Verify:** the probe is 2-stage (Basic-auth `plan.json`, then CDP WS handshake) and never logs the key; check `browserstackLastVerified` in `/api/config`; replay failures raise `BrowserStackStrictError` in strict mode.
- **Fix:** correct user/key in Settings; without credentials BrowserStack tests intentionally assert FAILURE in strict mode (never fake green). Note: agent missions always run locally — BrowserStack applies to test-case replay only (C4 agent attach was lost, not built).

## Mission stuck / never starts

- **Verify:** `GET /api/v1/missions/:id` (states CREATED→QUEUED→RUNNING→terminal); governor stats via `/api/v1/missions` envelope; stuck-mission watchdog is built in.
- **Likely causes:** governor queue (1 concurrent slot), 20-min turn wall clock, 5-min model-idle watchdog, budget exhausted (`budget_exhausted` 409 on revalidate). `POST /:id/stop` aborts.

## LLM timeout / agent idle

- **Verify:** Settings → Test Connection (GET `{baseUrl}/models`, 12s); agent log lines in the service log.
- **Cause:** wrong base URL (must include `/v1` if the gateway expects it), key invalid, gateway down. `callLLM` retries twice on 429/5xx/network then surfaces the error — enrichment failures never block missions.

## Missing evidence

- **Verify:** `GET /api/v1/missions/:id/evidence`, `/evidence/coverage`, `/evidence/integrity`; session `observations`.
- **Fix path:** integrity verify endpoint reports breaks; artifacts live under `.qase/artifacts/<runId>/` (screenshots referenced by count in stores). Evidence pruning is explicit — nothing is auto-deleted.

## OpenAPI unavailable

- **Verify:** `curl -i https://<host>/openapi.json` — expect 200 `application/json`. It is public and served from code (no file dependency).
- **502 from production:** transient edge re-route during pod reschedule (observed 2026-08-29, self-healed in minutes). Verify the pod directly if it persists.
- **Truncation/parse errors in a consumer:** historically caused by the consumer's paste-box or a trailing space in the token header — the endpoint serves the complete 64 KB document (verified via plain/gzip/browser/Range fetches).

## Production / preview mismatch

- **Current truth:** preview = C3, production = C2, plus prod advertises an internal `servers[0].url` until `QASE_PUBLIC_URL` is set there. Same 32 operations either way.
- **Fix:** normal deploy flow (push → config → rolling restart) + set prod `QASE_PUBLIC_URL=https://qase.drytis.com`.

## Tests failing "for no reason"

- **c1-usage-api 19 fails:** `.env`'s `QASE_BASE_URL` (LLM) shadows the server URL the tests expect → `export QASE_BASE_URL=http://localhost:5173`.
- **device-execution 3 fails:** benchmark apps not running → `python3 scripts/serve-benchmarks.py &`.
- **Everything 401s:** `QASE_API_TOKEN` not exported into the test shell → load `.env` (`set -a; . ./.env; set +a`).

## Container quirks

- `git` fatal "unable to access /home/coder/.gitconfig: Structure needs cleaning" → prefix `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1`.
- Whole-container restart wipes uncommitted work → publish first (see OPERATIONS-RUNBOOK warning).
