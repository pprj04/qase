# QASE — Operations Runbook

All commands verified against `package.json` scripts and the running container (2026-08-29).

## Start / stop / health

```bash
npm install && npm run install-browser   # first time (deps + Chromium)
npm start                                # foreground: node server/index.js (port 5173)
npm run dev                              # node --watch (dev only)

# Platform-managed (this workspace):
procmgr status                           # expect qase-server-v2 RUNNING
procmgr restart qase-server-v2           # app-only restart
# Container restart = full workspace reset to last pushed commit (see warning)

curl -s http://localhost:5173/api/health          # {"status":"ok","uptime":...}
curl -s https://<host>/api/v2/health              # public liveness (any env)
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/openapi.json   # expect 200
```

⚠ **Restarting the whole container destroys uncommitted work** (happened 2026-08-27; lost C4). Commit/publish before any `restart_container`.

## Logs

```bash
tail -f /var/log/services/qase-server-v2.log   # app stdout (banner, config.problem, missions)
tail -f /var/log/caddy/access.log              # edge access (json format)
```

## Environment / configuration

Actual `.env` is platform-managed (`/workspace/.env`, gitignored, regenerated from env-key records — never hand-edit). Template: `.env.example`.

| Var | Purpose | Default | Sensitive | Restart | Used by |
|---|---|---|---|---|---|
| `PORT` | HTTP port | 5173 | no | yes | server bind |
| `QASE_HOST` | bind host | 0.0.0.0 | no | yes | server bind |
| `QASE_PROVIDER` | LLM provider id | custom | no | yes | agent SDK |
| `QASE_API_KEY` | LLM key | — | **YES** | yes | agent + callLLM |
| `QASE_BASE_URL` | LLM endpoint root | — | no | yes | agent + callLLM |
| `QASE_MODEL` | model id | — | no | yes | agent + callLLM |
| `QASE_API_TOKEN` | instance API token (gates /api) | — | **YES** | no (read per request) | requireApiToken |
| `QASE_INTEGRATION_SECRET` | HMAC secret for /api/v1/integration | — | **YES** | yes | integrationAuth |
| `QASE_ALLOWED_LOCAL_TARGETS` | loopback ports the agent may target | 9901–9907,9930,9931 | no | no | targetGuard |
| `QASE_PUBLIC_URL` | advertised OpenAPI servers url | request origin | no | no | openapiDocument |
| `QASE_TRUST_PROXY` | trust X-Forwarded-* | true | no | yes | express |
| `QASE_HEADLESS` | headless browser | true | no | next session | agent |
| `QASE_MAX_TURNS` | default turn budget | 120 | no | no | missions (clamped 1–500) |
| `QASE_FIX_VALIDATION_ATTEMPTS` | validation attempts | 2 | no | no | validationExecutorCore |
| `QASE_ADMIN_KEY_ID` | integration admin principal id | qase-admin | no | boot | bootstrap |
| `QASE_WEBHOOK_URL` | simple fire-and-forget notifier | unset | no | no | webhooks.js |
| `QASE_ENABLE_DEMO` | serve /demo practice site | true | no | yes | demoSite |
| `QASE_AUTH_FILE` | Playwright auth state path | .qase/auth.json | no | no | agent |

**Precedence:** stored config (`.qase/config.json`, saved via Settings UI) **overrides** env for LLM provider fields; env is the seed. Everything else is env-or-default. `config.problem` in the boot banner tells you if the LLM is unconfigured.

⚠ **Test-runner collision:** the app's `.env` sets `QASE_BASE_URL` to the LLM endpoint, but the test suite uses the same var for the *server* base. Export `QASE_BASE_URL=http://localhost:5173` (or use `QASE_TEST_BASE_URL`) when running tests, and run `python3 scripts/serve-benchmarks.py` first for device/browser tests (ports 9901–9907).

## Tests

```bash
python3 scripts/serve-benchmarks.py &        # benchmark targets (9901–9907)
export QASE_BASE_URL=http://localhost:5173   # override .env's LLM URL
npm run test:gate                            # protected regression core
npm run test:core|unit|api|contract|e2e|accessibility|responsive|performance|security|truthfulness
node --test tests-real/<file>.test.js        # single file
npm run test:openapi                          # OpenAPI validator (live URL)
```

Latest verified status (2026-08-29): gate-mode suites observed green — b0-* (7/7), b1-* (52 tests incl. security-negative 17), b2-* (15), c2-* (32), c3-* (33), m1-p4.3/4.4 (69), browserstack-trust, execution-provenance, device-context. Two env-affected suites verified green individually: c1-usage-api **20/20**, device-execution **27/27** (with benchmarks up). Full `test:all` in one window: NOT VERIFIED this session.

## OpenAPI

```bash
npm run test:openapi
node scripts/validate-openapi.mjs --url http://localhost:5173/openapi.json
curl -s https://<host>/openapi.json | head -c 300
```

## Benchmark apps (targets for testing)

`scripts/serve-benchmarks.py` serves `.drytis/benchmarks/app{1..10}*.html` on :9901–:9907 (CRM, TaskBoard, Shop, Analytics, Marketing, ContactVault buggy/fixed…). Not registered as a service — start ad hoc for test runs. (`scripts/bench-servers.sh` wraps it for procmgr use if you want it persistent.)

## Environments

| Env | URL | Code | Notes |
|---|---|---|---|
| workspace | localhost:5173 | main @ C3 | editable |
| preview | https://pulse-review-workspa-6grhjr.drytis.dev/ | C3 | Caddy `/` → :5173 |
| production | https://qase.drytis.com | **C2** | deploy = push to origin then platform rolling restart |

Production deploy sequence (code change): dev verify → commit+push → platform config push → rolling restart → `get_production_status` + smoke `curl https://qase.drytis.com/openapi.json`. Set prod `QASE_PUBLIC_URL=https://qase.drytis.com` when you do (fixes advertised servers url).

## Daily ops gotchas

- Git in this container needs `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1` (global gitconfig is corrupted).
- `tests/` + `docs/phase-3-knowledge-audit.md` report "Structure needs cleaning" — cosmetic; avoid destructive git ops over them.
- First UI open shows the token gate until the instance token is pasted (stored in localStorage `qase_token`).
- SSE live updates authenticate via `?token=` — keep the token out of shared URLs.
