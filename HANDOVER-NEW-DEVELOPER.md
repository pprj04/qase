# Qase — Developer Handover

_Last updated: 2026-08-29 · Code state: `main` @ `2a22a74` (C3) · Production: `qase.drytis.com` @ C2 (`1766bec`)_

---

## 1. What Qase is

An **autonomous QA agent**. You give it a target URL (from an allowlist); an LLM-driven agent drives a real Chromium browser (Playwright) to explore the site, write a test plan, execute it, file bugs as structured findings, record test cases and workflows, replay them as regression suites, self-heal broken tests, and validate fixes. Single-tenant, self-hosted, one Node process. Built on `@cleanslate/sdk`.

## 2. Stack & run

- **Node ≥ 20**, Express 5, ES modules (`"type": "module"`), no TypeScript, no build step for the frontend.
- Frontend: vanilla-JS SPA in `public/` (hash router, light/dark themes). Served statically by the same server.
- LLM: any OpenAI-compatible endpoint (Settings → provider/key/baseUrl/model). Current gateway: `llm.drytis.ai/v1`, model `z-ai/glm-5`.
- Data: **file-based JSON stores** in `/workspace/.qase/*.json` (~25 stores). No SQL database is used (MySQL is provisioned by the platform but intentionally stopped).
- Browser: Playwright Chromium (bundled; system libs installed by the setup script). Optional BrowserStack (unconfigured → "strict mode": BrowserStack-requested runs fail loudly rather than silently falling back).

```bash
npm install && npm run install-browser   # deps + Chromium
npm start                                 # serves http://localhost:5173
```

First run: open the UI, paste the instance API token (gate), then Settings → fill provider/key/baseUrl/model. A built-in practice target is served at `/demo` (demo@qase.dev / demo1234).

**Tests:** `npm test` (all) or `npm run test:gate|core|unit|api|e2e|security|truthfulness|openapi…`. Suite lives in `tests-real/` (71 files). Integration tests that hit the API need `QASE_API_TOKEN` in the environment or every /api call 401s.

## 3. Environments

| | URL | Code | Notes |
|---|---|---|---|
| Dev workspace | (this container) | `main` @ C3 | Live-editing environment |
| Preview | `https://pulse-review-workspa-6grhjr.drytis.dev/` | C3 | Caddy reverse-proxies `/` → :5173 |
| **Production** | `https://qase.drytis.com` | **C2** (`1766bec`) | One build behind. Deploy = commit/push to origin, then platform redeploy (container pulls on boot) |

Platform mechanics: background service `qase-server-v2` (`node server/index.js`) is managed by `procmgr` (`procmgr status|restart|reload`). The setup script (runs on every container boot) installs npm deps, Chromium system libs, `playwright install chromium`, and patches the Caddyfile Host-header placeholder. **Warning: a container restart resets /workspace to the last pushed commit — uncommitted work is destroyed. This happened on 2026-08-27 and lost an entire workstream (see §9). Commit before restarting.**

## 4. Configuration

Env vars are stored via the platform's env-key system into `/workspace/.env` (gitignored; never edit by hand — the platform regenerates it). Key variables:

| Var | Purpose |
|---|---|
| `PORT` (5173), `QASE_HOST` (0.0.0.0) | server bind |
| `QASE_API_KEY`, `QASE_BASE_URL`, `QASE_MODEL` | agent LLM (OpenAI-compatible) |
| `QASE_API_TOKEN` | **instance Bearer token** (also mirrored in `.qase/config.json`) — gates everything under `/api` |
| `QASE_INTEGRATION_SECRET` | HMAC secret for `/api/v1/integration/*` signed requests |
| `QASE_ALLOWED_LOCAL_TARGETS` | targetGuard allowlist of local ports (benchmark/webhook apps) |
| `QASE_PUBLIC_URL` | advertised base URL in the OpenAPI `servers` entry (falls back to request origin) |
| `QASE_TRUST_PROXY`, `QASE_HEADLESS`, `QASE_MAX_TURNS`, `QASE_ENABLE_DEMO`, `QASE_AUTH_FILE` | behavior toggles |

Secret values are NOT reproduced here — new developer: read them from the platform project settings or `/workspace/.env` in the container. BrowserStack creds (if ever configured) live encrypted in `.qase/config.json` per the C4 design.

## 5. Authentication model (B1 — do not weaken)

1. **Instance token** (`QASE_API_TOKEN`): static, long-lived. Accepted three ways: `Authorization: Bearer …`, `qase_token` cookie, `?token=` query param (for EventSource). When set, **every** `/api/*` route requires it (`requireApiToken` middleware in `server/index.js`). The cookie is never auto-granted to anonymous visitors; the SPA stores it in localStorage after the first-run token gate.
2. **Integration principals** (`/api/v1/integration/*`): HMAC-SHA256 signed requests (`server/integrationAuth.js`), admin + workspace-scoped principals, mission create/stop/findings-read scopes. Seeded in `.qase/integrations.json`.
3. Public routes: `/openapi.json`, `/api/v2/health`, `/demo`, static assets. Everything else 401s anonymously.

## 6. API surfaces

| Surface | Prefix | Auth | Purpose |
|---|---|---|---|
| Legacy/agent API | `/api/*` | Bearer | Sessions, runs, messages, findings, test cases, workflows, config, artifacts… (`server/index.js`) |
| **Pulse read API** | `/api/v2/*` | Bearer | 32 GET-only analytics endpoints for external agents (Drytis Pulse). Envelope `{data,total,page,page_size}`, page_size clamp 500. (`server/pulseV2Router.js`, projection in `pulseProjection.js`) |
| **OpenAPI document** | `GET /openapi.json` | public | Live-generated 3.1.0 doc from `server/openapiDocument.js` (32 GETs, zero writes documented) |
| Integration API | `/api/v1/integration/*` | HMAC | scoped machine-to-machine missions/findings |

Validate the doc: `npm run test:openapi` (or `node scripts/validate-openapi.mjs --url http://localhost:5173/openapi.json`).

## 7. Codebase map

- `server/index.js` (4.4k lines) — Express app, route mounting, auth middleware, correlation IDs, legacy API.
- 85 modules in `server/`. Notable: `agent.js` (agent loop + SDK attach), `decisionEngine.js`/`decisionTraces.js` (INVESTIGATE/REPLAN/CONTINUE autonomy, 13-field traces), `missionGovernor.js` (concurrency/queue, budget pool), `midSessionProbe.js` (C3 K=4 probe), `targetGuard.js` (SSRF allowlist), `knowledge.js`, `featureGap.js`, `fixValidation.js`, `replay.js`/`regressionStore.js`/`scheduler.js`, `uxSweep.js`/`uxAssessment.js`, `webhooks.js`, `openapiDocument.js`+`pulseV2Router.js`+`pulseProjection.js` (the C1 read surface).
- `public/` — SPA: `app.js` (2.9k lines), `router.js`, page modules (`tests.js`, `bugs.js`, `workflows.js`, …), `shared.js` (fetch wrapper that injects the token).
- `scripts/` — `run-tests.mjs` (suite runner), `validate-openapi.mjs`, `package.mjs`.
- `.qase/` — all runtime data (sessions, findings, missions, decision traces, api-usage…). Treat as the database.
- `docs/` — deep history: per-phase final reports, models (finding lifecycle, bug intelligence, fix status), security audits, C1 playbook.
- `.drytis/specs/` — build specs; `.drytis/notes/` — postmortems (read `restart-wipes-uncommitted-work.md` first).

## 8. Build history (all on `main`)

- **Phases 1–18** (Jul 31–Aug 17): core agent → workflows/replay/regression → autonomy pipeline → UX intelligence → fix validation.
- **Builds 1–4 + cleanup** (Aug 21): demo polish, execution truthfulness, dead-code removal.
- **M1-P3/P4** (Aug 24): hardening — state safety, targetGuard SSRF boundary, mission governor, persistence hygiene.
- **B0** (Aug 25): baseline hygiene/ops fixes.
- **B1** (Aug 25): integration contract + security boundary (token gate, HMAC, correlation IDs).
- **B2** (Aug 26): autonomous control loop (decision engine, budget pool, decision traces).
- **C1** (Aug 26): Dev-team/Pulse read API (`/api/v2` + `/openapi.json` + usage telemetry).
- **C2** (Aug 27): production autonomy decisions ← **what production runs**.
- **C3** (Aug 27): finding quality + mid-session autonomy ← current HEAD.

## 9. Known state & gaps (read before changing anything)

1. **Lost workstream:** a container restart on 2026-08-27 destroyed all uncommitted post-C3 work: (a) an OpenAPI guide-audit patch ({data,total} envelopes on `/api/v2/projects` + `/regression/trend`, extra filters, name joins, schema detail); (b) the **entire C4 BrowserStack productionization** (encrypted secret store `secretStore.js`, agent runtime attach, settings UX). None of it was committed. C4 must be rebuilt from spec `.drytis/specs/C4-browserstack-production.md` if wanted.
2. **No read-only token.** The single Bearer token is full read/write. Pulse guide wants read-only; options A/B/C in `QASE-API-HANDOFF/README.md` — undecided.
3. **Production is one build behind** (C2) and its `/openapi.json` advertises `servers[0].url = http://127.0.0.1:5173` (internal Host passes through; `QASE_PUBLIC_URL` unset in prod env — set the production override to `https://qase.drytis.com` when you deploy).
4. `tests/` and `docs/phase-3-knowledge-audit.md` show FS-corruption warnings (`Structure needs cleaning`) — cosmetic git noise; avoid destructive git ops that touch them. Global gitconfig is corrupted in the container: prefix git with `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1`.
5. Handoff artifacts: `QASE-API-HANDOFF/` (openapi.json snapshot + README + validation). Verified 2026-08-29: preview 200 ✓, prod 200 ✓, file parses ✓, 32 GETs, validator 0 violations.

## 10. First week suggested reading order

1. This file → 2. `README.md` → 3. `.drytis/specs/B1-integration-contract-security.md` + `C1-DEV-TEAM-PLAYBOOK.md` → 4. `server/index.js` route map + `openapiDocument.js` → 5. `.drytis/notes/restart-wipes-uncommitted-work.md` → 6. run `npm run test:gate` to confirm a green baseline before touching anything.
