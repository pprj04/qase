# B1 PHASE 0 — READ-ONLY AUDIT (current tree, verified against code)

Date: 2026-08-25 · Base: main @ 0525ba7 (B0 published) · Auditor: B1 build agent.
Every claim below was re-verified against the live tree in this session — not copied from prior reports.

## Classification legend
IMPLEMENTED+VERIFIED · IMPLEMENTED+NOT VERIFIED · PARTIAL · DOCUMENTATION ONLY · NOT IMPLEMENTED

## Route inventory (generated, not estimated)

- `server/index.js`: 124 routes total; **52 anonymous GETs** (full list in appendix A).
- `server/phaseRouter.js`: 34 routes (21 GETs); effective **6 anonymous GETs** via `PUBLIC_READ_GET` pattern exemptions + `/findings/export`.
- **Total anonymous GET surface = 58.** (The prior "~59–60" estimate was accurate; now exact.)
- Notable anonymous reads: `/api/artifacts/:runId/:filename` (screenshots/traces public), `/api/config`, `/api/sessions`, `/api/findings`, `/api/missions`, `/api/knowledge`, `/api/test-cases`, `/api/schedules`, `/api/regression/*`, `/api/metrics/dashboard`, SSE `/api/sessions/:id/events`.
- **Contradiction found:** `/api/findings/grouped` matches the public pattern `/^\/findings\/[^/]+$/` and is therefore **anonymous**, while the adjacent comment in `phaseRouter.js` claims it is explicitly authed. Comment is wrong; route is public.

## W1 — Integration authentication: **NOT IMPLEMENTED**

- `server/integrationAuth.js` does not exist.
- `QASE_INTEGRATION_SECRET` (present in `.env`) has **zero consumers** — grep across `server/`, `public/`, `scripts/` finds no reference.
- Only auth is `requireApiToken` (index.js): ONE static bearer token from config (`QASE_API_TOKEN`), timing-safe `safeEqual`, accepted via `Authorization: Bearer` or legacy `qase_token` cookie. If no token configured → everything open.
- No principals, no scopes, no expiry, no per-request signing. Phase 16/17/18 docs describe an integration auth layer that was lost to documented disk corruption (phaseRouter.js header admits reconstruction "from the test-suite contract").

## W2 — Workspace/project authorization: **PARTIAL (storage only, zero enforcement)**

- `workspaceId` exists on missions (`missions.js` createMission, set at creation) and projects (`projects.js` set-once via updateProject — no project in `.qase/projects.json` currently has one).
- `listMissions` supports `workspaceId`/`correlationId` filters — but **no route passes workspaceId**.
- No ownership check anywhere on any read or write. Anonymous reads bypass everything.
- Missions carry `idempotencyKey` + `correlationId` fields (Phase 10 design) — never used (see W4).

## W3 — Close anonymous read surface: **NOT IMPLEMENTED**

- 58 anonymous GETs (inventory above). `/api/health` intentionally public. SSE endpoint anonymous because `EventSource` cannot send headers (UI constraint, must be preserved via query-token or cookie).
- UI first-load currently **depends** on anonymous GETs: `boot()` fetches `/api/config`, `/api/projects`, `/api/sessions` before any token may exist (token only enters localStorage after the user pastes it in Settings). Closing the surface therefore REQUIRES a minimal UI auth gate on 401 — no redesign, reuses the existing Settings token pattern. Flagged for operator awareness; treated as in-scope for W3 ("UI must remain functional").

## W4 — Idempotency + correlation: **NOT IMPLEMENTED (missions) / IMPLEMENTED (fix-validation)**

- `POST /api/v1/missions` has no Idempotency-Key handling. `findByIdempotencyKey` exists (`missions.js:202`) with **zero callers**.
- Fix-validation idempotency is real and tested (`phaseRouter.js` revalidate route: same key → duplicate response; persisted in `fix-validations.json`).
- Correlation IDs: no middleware, no header handling, no log stamping anywhere. Mission field exists but nothing writes it on the API path.

## W5 — Webhooks: **PARTIAL (two fire-and-forget systems, unsigned, in-memory)**

1. Global `QASE_WEBHOOK_URL` (`webhooks.js`): events `qa_report`, `test_failure`; 5s timeout; no signature, no retry, no persistence.
2. Per-mission registry `POST /api/v1/webhooks` → **in-memory `Map` (index.js:2692)** — lost on restart; fired unsigned via `fetch` on completion (`fireMissionWebhooks`), SSRF-validated through `targetGuard.validateWebhookUrl` (good — keep). No retry, no delivery records, no `finding.revalidated` event, no mission.failed event.

## W6 — Mission maxTurns: **NOT IMPLEMENTED (break confirmed at exact lines)**

- `POST /api/v1/missions` builds `contextForMission` from only `buildPrompt|requirements|businessGoals|testCredentials` — **`body.context.maxTurns` is dropped** (index.js:1756–1761).
- Agent runtime reads only global `settings.maxTurns` (`agent.js:144 → 161` → `createNodeProviderConfiguration({ maxTurns })`). Mission value never reaches execution.
- Enforcement opportunities verified: (a) SDK accepts per-runtime `maxTurns` at construction; (b) `assistant_turn_start` stream events carry `part.turnIndex` (`agent.js:494`) — usable as an independent external turn counter for a belt-and-braces abort + truthful `turnCount` recording.

## W7 — API contract: **PARTIAL**

- `tests-real/api-contract/contract-baseline.test.js` freezes 42 live behaviors (good) but no `docs/openapi.yaml`, no integration guide, no reference client exist.
- Pagination exists (`pagination.js` `paginateList`) but is inconsistent across routes (some return bare arrays).

## W8 — Secret/BrowserStack hygiene: **PARTIAL**

- `QASE_INTEGRATION_SECRET` env-only (unused — see W1). GET `/api/config` returns hints only (masked last-4) — content is safe; the endpoint being anonymous is a W3 issue.
- BrowserStack credentials stored plaintext in `.qase/config.json` (documented B0 finding; encryption at rest explicitly out of B1 scope).
- BrowserStack test-pollution guard: `tests-real/execution-provenance.test.js` §6 already does snapshot → modify → test → **restore in `finally`** including full user/key restore ("BUILD 2 hardening" comment). Remaining residual risk: restore is an API PUT that can race a server restart — W8 documents; no redesign.

## Verified foundations B1 builds on (do not touch)

- **targetGuard** (`validateTargetUrl` / `validateWebhookUrl`): strong global SSRF boundary incl. DNS + redirect + page-level enforcement — keep frozen.
- **M1-P4.4 persistence**: 12 store flushers registered (`shutdown.js` registry, `index.js:2987–2998`); corrupt-file preservation pattern (missions.js `loadMissions`); atomic writes. New B1 stores (integrations registry is secret-free; webhook deliveries/subscriptions) will follow this exact pattern.
- **Mission governor** (M1-P4.2), **state transitions** (M1-P4.3), **fix-validation engine** (Phase 18): all functioning; B1 only adds event hooks (finding.revalidated) without touching decision logic.

## Phase-0 conclusion

**Nothing B1 builds already exists as enforced code.** The Phase-10 field scaffolding (workspaceId/idempotencyKey/correlationId on missions) is present and reusable — B1 wires it, it does not re-architect. No stop-condition hit: no auth architecture conflict (there is none), maxTurns is enforceable at two independent layers, webhook persistence fits the existing store pattern, ownership resolves via mission.workspaceId ∨ project.workspaceId. Proceeding to implementation in order W1→W8 with per-workstream tests.

## Appendix A — 52 anonymous GETs in index.js

/api/artifacts/:runId/:filename · /api/health · /api/config · /api/sessions · /api/sessions/:id · /api/sessions/:id/detail · /api/sessions/:id/report.md · /api/sessions/:id/pipeline-status · /api/sessions/:id/dev-intelligence · /api/sessions/:id/app-understanding · /api/sessions/:id/app-understanding-summary · /api/sessions/:id/feature-gaps · /api/findings/:id/dev-analysis · /api/findings/:id/fix-prompt · /api/sessions/:id/app-improvement-prompt · /api/sessions/:id/dev-report · /api/knowledge · /api/knowledge/:id · /api/missions/:id/knowledge · /api/sessions/:id/knowledge · /api/knowledge-stats · /api/sessions/:id/decision · /api/sessions/:id/decisions · /api/missions/:id/decisions · /api/sessions/:id/workflow · /api/workflows · /api/workflows/:id · /api/test-cases · /api/test-cases/export · /api/test-cases/tags · /api/test-cases/:id · /api/suites · /api/test-cases/:id/runs · /api/test-cases/:id/baselines · /api/schedules · /api/schedules/:id/runs · /api/regression/trend · /api/regression/runs · /api/regression/runs/:id · /api/sessions/:id/events (SSE) · /api/metrics/dashboard · /api/projects · /api/findings · /api/missions · /api/findings/stats · /api/findings/export · /api/findings/:id · /api/sessions/:id/export/findings · /api/missions/:id · /api/v1/missions/:id/loop-status · /api/v1/missions/:id/evidence-coverage · /api/v1/evidence/stats

## Appendix B — 6 effective anonymous GETs in phaseRouter

/findings/export · /findings/:id/evidence · **/findings/grouped (contradicts its own comment)** · /missions/:id/mission-for-session · /missions/:id/ux-quality · /v1/findings/:id/validation
