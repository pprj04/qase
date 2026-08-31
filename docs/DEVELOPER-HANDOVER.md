# QASE — Developer Handover (Complete)

_Version 2026-08-29 · verified against `main` @ `2a22a74` (C3) · companion docs: ARCHITECTURE.md, API-HANDOVER.md, OPERATIONS-RUNBOOK.md, TROUBLESHOOTING.md, BUILD-HISTORY.md, developer-handover-summary.json_

> Truth rules: everything below was verified from the current repository, runtime, or platform records on 2026-08-29. Anything unverifiable is marked **NOT VERIFIED**. No secrets appear in this document.

## 1. Repository inventory

| Path | What it is |
|---|---|
| `server/` | 86 ES-module JS files. Entry: `server/index.js` (4,465 lines) |
| `public/` | Vanilla-JS SPA: `index.html` (867 lines), `app.js` (2,956), `shared.js`, `router.js`, page modules (`tests.js`, `bugs.js`, `workflows.js`, `schedules.js`, `pipeline.js`, `executionDetail.js`, `deviceClassify.js`), `styles.css` |
| `tests-real/` | 71 `*.test.js` files — the real suite (see §18 / OPERATIONS-RUNBOOK) |
| `tests/`, `tests_old/` | Legacy test dirs. **`tests/` currently reports FS corruption ("Structure needs cleaning")** — cosmetic git noise; do not delete |
| `scripts/` | `run-tests.mjs` (suite runner, modes: all/gate/core/unit/api/contract/e2e/accessibility/responsive/performance/security/truthfulness), `validate-openapi.mjs`, `serve-benchmarks.py` + `bench-servers.sh` (benchmark apps on :9901–9907), `package.mjs`, benchmark drivers (`b2-benchmark.mjs`, `c2-benchmark.mjs`, `fix-validation-benchmark.mjs`, `ux-benchmark.mjs`, `c2-adaptive-proof.mjs`, `phase18-lifecycle-run.mjs`) |
| `docs/` | ~40 per-build reports/models (B0–C3, M1 series, finding/bug/fix models, C1 playbook) |
| `.drytis/` | `spec.md`, ARCHITECTURE/KNOWLEDGE/MISSION/ROADMAP, `specs/` (per-build specs), `notes/` (postmortems — **read `restart-wipes-uncommitted-work.md`**), `cred.json` (test creds), `benchmarks/` (10 static benchmark apps), phase reports |
| `.qase/` | **Runtime data — the database** (~25 JSON stores + `artifacts/` screenshots; see §11) |
| `QASE-API-HANDOFF/` | OpenAPI snapshot + validator output for the Dev Team (uncommitted) |
| `examples/`, `userDocs/` | Reference material; not part of the runtime |
| Config | `package.json`, `package-lock.json`, `.env.example` (committed template — actual `.env` is platform-managed, gitignored) |
| Container/proxy | No Docker/CI files in the repo. `/etc/caddy/Caddyfile` (auto_https off, `:80`, `/health` → "Development Environment OK"); platform Caddy proxies `/` → 127.0.0.1:5173. Background service `qase-server-v2` = `node server/index.js` under procmgr |

**Entry points:** server `server/index.js` (npm start); frontend `public/index.html` served statically by the server; tests `scripts/run-tests.mjs`; OpenAPI validation `scripts/validate-openapi.mjs`.

**Commands:** `start`, `dev` (node --watch), `install-browser`, `package`, `test`/`test:all`/`test:gate`/`test:core`/`test:unit`/`test:api`/`test:contract`/`test:e2e`/`test:accessibility`/`test:responsive`/`test:performance`/`test:security`/`test:truthfulness`/`test:openapi`.

**Dependencies:** `@cleanslate/sdk ^0.1.0`, `express ^5.2.1`, `dotenv ^17.4.2`, `cron-parser ^5.6.2`, `pixelmatch ^7.2.0` + `pngjs ^7.0.0` (visual diff), `ws ^8.18.0`. Node ≥ 20, ES modules throughout, no TypeScript, no frontend build step.

## 2. Application purpose

**Qase is a self-hosted, autonomous QA agent.** You register a target application (URL), optionally with test credentials; Qase's LLM-driven agent drives a real Chromium browser to explore the app, execute a test plan, and file what breaks as structured findings — then replays saved workflows as regression suites and validates fixes.

- **Problem:** manual exploratory testing + regression upkeep doesn't scale for small teams; existing tools record but don't reason.
- **Users:** engineers/owners of web apps (single tenant — one operator per instance); plus external analytics agents (Drytis Pulse) reading the `/api/v2` surface via OpenAPI.
- **Normal user workflow:** open UI → token gate → Settings (LLM provider/key/model, optional BrowserStack) → create a session with a target URL → watch the agent explore live (SSE) → review findings, evidence, generated test cases → save workflows → schedule regression → approve/resolve findings after fix validation.
- **Autonomous workflow:** see §9 (autonomy) — mission → governor slot → agent turns → decision cascade every turn boundary → CONTINUE/INVESTIGATE/REPLAN/STOP → fix validation → report.

**Lifecycle (implemented today):**

```
Target app (allowlisted URL)
   ↓ mission (intent, budget, credentials-by-placeholder)
   ↓ mission governor (queue → 1 slot = session + Chromium + LLM)
   ↓ agent loop (CleanSlate SDK; tools: report_finding, finish_qa_report)
   ↓ browser interaction (Playwright/Chromium; targetGuard page boundary)
   ↓ evidence capture (screenshots, traces, console, network → evidence graph)
   ↓ findings (deterministic enrichment; never auto-confirmed)
   ↓ decision engine (deterministic rule cascade, no LLM)
   ↓ CONTINUE / INVESTIGATE / REPLAN / STOP
   ↓ fix validation (replay-based attempts → fixStatusEngine classifies)
   ↓ final report + knowledge write-back (validated patterns only)
```

**Outputs:** structured findings (severity/confidence/evidence/category), test cases (auto-generated from workflows), saved workflows, regression run history + trends, fix-validation verdicts (VERIFIED_FIXED / STILL_BROKEN / …), decision traces (13-field audit records), markdown/JSON reports, evidence graph, knowledge patterns, dashboard metrics, and the read-only `/api/v2` surface for external tools.

## 3–5. Architecture / Frontend / Backend

→ **Full detail in `docs/ARCHITECTURE.md`** (component map incl. every module, route table with auth + source lines, middleware order, data flow). Summary here:

- **One Node process**, Express 5. Middleware order: raw-body-capturing JSON parser → cookie refresh (never grants) → correlation IDs → static SPA → artifacts (traversal-guarded) → demo site → `/api` phaseRouter (token-gated except `/v1/integration` + `/v2`) → `/api/v2` Pulse router (health public) → `/api/v1/integration` (HMAC) → `/openapi.json` (public).
- **Agent runtime** wraps `@cleanslate/sdk` (the SDK owns LLM transport for agent turns); direct LLM calls (`callLLM` in `testGen.js` → `{baseUrl}/chat/completions`) serve six enrichment purposes (test-gen, finding analysis, app report, self-heal, feature-gap enhancement, app-understanding). Current gateway/model are config values, not code.
- **Persistence:** all file-based JSON via `atomicWrite.js` (temp+rename) into `.qase/`. No SQL/Redis in use (platform MySQL provisioned but stopped by design).
- **Concurrency:** missionGovernor bounds concurrent agent missions (FIFO); test-suite runs have their own concurrency/retries; scheduler ticks every 60 s.
- **Frontend:** no framework — hash-routed SPA, fetch wrapper injecting the Bearer token, SSE for live run updates, light/dark themes. Pages: Runs (default), Tests, Bugs, Workflows, Schedules, Settings. First-run token gate overlays until a valid token is stored in localStorage.

## 6. API

→ **`docs/API-HANDOVER.md`.** Verified live: `GET /openapi.json` → 200 `application/json`, OpenAPI **3.1.0**, **32 GET operations** (32 unique snake_case operationIds), validator 0 violations. Auth scheme documented: `bearerAuth`. Envelopes `{data,total,page,page_size}`, page_size clamp 500, ISO-8601 timestamps. The Dev Team already consumes this via Pulse — nothing to change.

## 7. Authentication & security

IMPLEMENTED (verified in code): instance Bearer token (header/cookie/query, timing-safe) on all `/api` except `/api/v2/health` + `/openapi.json` + `/demo`; HMAC-SHA256 signed integration auth with scopes + workspace matching; SSRF/targetGuard allowlist enforced at ingest and browser page boundaries + webhook URL validation; session-scoped secret vault (agent sees placeholders only); secret redaction on evidence/exports/errors; correlation IDs; atomic writes; no CORS (single-origin); decision traces contain no prompts/content; SSE authenticated via the token query param; BrowserStack key stored plaintext in config store today (masked in every API response — `hasBrowserstackKey` boolean only). **NOT IMPLEMENTED:** rate limiting, encrypted-at-rest BrowserStack secret store (was C4, lost), separate read-only API token, CSRF tokens (mitigated by no-CORS + Bearer-only auth).

## 8–15. LLM / Autonomy / Browser / Data / Evidence / Findings / Regression / Scheduling

→ covered in ARCHITECTURE.md §AI, §Autonomy, §Browser, §Storage, and below. Key facts:

- **Autonomy (genuine, today):** deterministic decision cascade (`decisionEngine.js`) runs at mission decision points and (C3) every 4 turns mid-session (`midSessionProbe.js`, authority=NONE — may only hint or request early stop). Budget: maxTurns clamp 1–500, hard abort in agent loop, turn-pool debits for revalidation; the autonomy layer **can never raise** maxTurns (source-tested). INVESTIGATE/REPLAN/CONTINUE mapping is guarded (C2). NOT autonomous: finding confirmation (human approves), fix application (humans fix; Qase only validates), test-case acceptance.
- **BrowserStack:** credential config + settings probe (`browserstackTest.js`, 2-stage, no minutes burned) + **test-case replay over CDP** (`replay.js` → `wss://cdp.browserstack.com/playwright?caps=…`, strict mode = loud failure, non-strict = local fallback with warning). **Agent/mission execution on BrowserStack does NOT exist** — that was lost C4 work. Spec to rebuild: `.drytis/specs/C4-browserstack-production.md`.
- **Findings lifecycle:** session finding → global store sync (missionId stamped, C3) → async deterministic enrichment (severity/category/root-cause with reasons) → duplicate detection → human review (approve→RESOLVED) → fix validation (replay attempts → deterministic `fixStatusEngine` verdict). Safeguards: low-confidence AI findings are never auto-confirmed; approval is a human action; feature-gap findings require explicit-expectation evidence (C3 gate).

## 16–24

- **Configuration** → OPERATIONS-RUNBOOK §Configuration (every var, defaults, sensitivity).
- **Running / Testing / Quick start** → OPERATIONS-RUNBOOK.
- **Build history** → BUILD-HISTORY.md (B0→C3 verified against git; **C4 never committed — was destroyed by the 2026-08-27 container restart; do not treat as built**).
- **Production state** → §20 below.
- **Known issues / Remaining work** → §21/§22 below + summary JSON.

## 20. Current production state (verified 2026-08-29)

| Environment | Code | URL | Status |
|---|---|---|---|
| LOCAL (workspace) | `main` @ `2a22a74` (C3), clean + uncommitted docs | — | server UP (`qase-server-v2`), tests runnable |
| PREVIEW | C3 | `https://pulse-review-workspa-6grhjr.drytis.dev/` | `/openapi.json` 200 ✓ |
| PRODUCTION | `1766bec` (C2) | `https://qase.drytis.com` | healthy per platform; `/openapi.json` 200 ✓ — a transient 502 window was observed 2026-08-29 ~06:31 UTC (pod reschedule, edge re-route lag; recovered on its own) |

Production is **one build behind** (C2 vs C3) and its `/openapi.json` advertises `servers[0].url = http://127.0.0.1:5173` (internal host passes through; `QASE_PUBLIC_URL` unset in prod env).

## 21. Known issues (verified)

- **P1** — Production one build behind + OpenAPI `servers[0].url` internal host (config-only fix: set prod `QASE_PUBLIC_URL=https://qase.drytis.com`, then normal deploy).
- **P1** — No read-only API token: the single Bearer token is full read/write; Pulse guide prefers read-only (options in `QASE-API-HANDOFF/README.md`).
- **P2** — C4 BrowserStack productionization lost to the 2026-08-27 restart; agent missions cannot run on BrowserStack (replay-only). Rebuild spec exists.
- **P2** — Test-suite ergonomics: `QASE_BASE_URL` double-booked (LLM endpoint for the app, server base for tests) — gate mode fails 19 c1 tests + 6 device tests until `QASE_BASE_URL=http://localhost:5173` is exported; benchmark apps must be running for device tests (`scripts/serve-benchmarks.py`).
- **P2** — `duplicateSuppression.js` is dead code (zero importers); duplicate route registrations exist between index.js and phaseRouter (`/api/findings/export`); `PUBLIC_READ_GET` configured to `[]`.
- **P3** — `tests/` + `docs/phase-3-knowledge-audit.md` report FS corruption (cosmetic); container gitconfig corrupted (use `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1`); edge occasionally 502s during prod pod reschedules (observed once, self-healed).
- **Investigated, NOT bugs:** shared-run token gate (B1 design, pre-C3, works as intended — verified 2026-08-27 across 3 browser contexts); "Settings broken" after gate (did not reproduce); OpenAPI JSON truncation (was Pulse-side paste-box + trailing-space token).

## 22. What remains

COMPLETED: B0–C3 (see BUILD-HISTORY.md). IN PROGRESS / BLOCKED: C4 BrowserStack (spec ready, code lost, not started again). NOT STARTED: C5 (per roadmap: LLM role separation/model governor/regression learning — mentioned in C4 spec scope boundary; **no code exists**), read-only token (options only), prod C3 deploy + `QASE_PUBLIC_URL` fix. OPTIONAL: OpenAPI guide-audit patch (envelopes on `/api/v2/projects` + `/regression/trend`, name joins) — was written, lost, spec survives at `.drytis/specs/pulse-openapi-audit-fixes.md`.

## NOT VERIFIED (explicit)

- `test:gate` full-suite completion inside one session window (ran 24/49 suites, all ✓; two env-affected suites verified green individually: c1-usage 20/20, device-exec 27/27 with benchmarks up; remaining suites not run this session).
- Full `test:all` run — NOT VERIFIED this session.
- Production data-store contents beyond sessions/HEAD checks.
- Any claim about C4 functionality — code does not exist in the repo.
