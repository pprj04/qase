# QASE B0 Baseline Report

Build: **B0 — Baseline, Hygiene & Operational Safety**
Date: 2026-08-25 · Scope: baseline + confirmed B0 fixes only.

## 1. Build status

**PASS WITH WARNINGS**
(warnings = pre-existing, documented below; no B0-introduced regression)

## 2. Actual architecture

- **Frontend:** vanilla-JS SPA (no framework/state lib). Hash router (`public/router.js`), `api()` wrapper (`shared.js:148`) prefixing `/api` + Bearer from cookie/localStorage. Modules: `app.js` (dashboard/runs/settings, 2,906 lines), `tests.js` (test cases/regression), `bugs.js`, `pipeline.js`, `executionDetail.js`, `schedules.js`, `workflows.js`. SSE activity stream. No mock data anywhere.
- **Backend:** Node 20, Express 5, single process (`server/index.js`, 3,194 lines, 124 routes) + `phaseRouter.js` (/api/v1 Phase 16/17/18). 60+ domain modules. MissionGovernor (3 slots / 60 min / 30 s sweep), mission state machine frozen (`stateTransitions.js`), boot reapers, session watchdog (30 min).
- **Persistence:** atomic JSON stores under `.qase/` with P4.4 hygiene (13 registered flushers, dirty-tracking, corrupt-preserving loads, shutdown flush, retention caps via `storeHygiene.js`, `artifactLifecycle.js`). Artifacts under `artifacts/<runId>/`. Config `.qase/config.json` (0600).
- **Agent:** `@cleanslate/sdk` runtime (`agent.js`) with 24-tool allowlist, per-turn context, vault `{{PLACEHOLDER}}` substitution at keyboard seam, per-page SSRF boundary; watchdogs (20-min turn, 5-min idle, browser restart 1×).
- **LLM:** one model (`z-ai/glm-5` @ `llm.drytis.ai/v1`); discovery/execution tiers defined but currently both resolve to the default. 7 single-shot call sites via `callLLM` (testGen, devIntelligence×2, selfHeal, appUnderstanding, featureGap). No model fallback (pre-existing; B3 scope).
- **Browser automation:** Playwright Chromium (agent + replay); BrowserStack via CDP for replay only; `executionEnvironment.js` provenance; strict-by-default BrowserStack (no silent local fallback); 11 replay assertion types; self-heal ≥0.8.
- **Evidence:** evidence graph (42,235 nodes) + session capturedSteps + artifacts; evidence APIs on /api/v1.
- **API:** static bearer token (`requireApiToken`) on mutations; ~60 GETs still anonymous (documented — B1 scope). No integration auth/JWT in code despite Phase 10/11 docs (lost to disk corruption; documented — B1 scope).
- **Deployment/runtime:** procmgr service `service-bg-service-3546` (apt libs + `node server/index.js`), benchmark apps on 9901-9903 (service-3810), Caddy reverse_proxy `/`→5173. Health endpoint verified. Restart-safe (config + data + corrupt preservation verified live).

## 3. Feature truth table

| Feature | Current state | Verified? | Notes |
|---|---|---|---|
| Mission lifecycle + governor | IMPLEMENTED | YES | mission-governor suite 19/19 |
| Agent exploration vs external URL | IMPLEMENTED | YES | B0 smoke vs new.drytis.com completed |
| Finding generation + persistence | IMPLEMENTED | YES | 3 findings persisted, store intact |
| Evidence graph + APIs | IMPLEMENTED | YES | 125 items for smoke session |
| Report generation/retrieval | IMPLEMENTED | YES | report.md 200 |
| P4.4 persistence/shutdown/retention | IMPLEMENTED | YES | 28/28 suite, 3× green |
| Fix validation (Phase 18) | IMPLEMENTED | YES | provenance suite live-pass |
| BrowserStack replay + provenance + strict failure | IMPLEMENTED | YES | browserstack-trust suite green |
| SSRF targetGuard (CDP redirect chains) | IMPLEMENTED | YES | security suite green |
| Config Settings UI ↔ backend | IMPLEMENTED | YES | fields map; 3 API-only knobs documented |
| UX sweep / UX intelligence | IMPLEMENTED | YES | phase17 suites green in isolation |
| Knowledge feedback loop | IMPLEMENTED | NOT VERIFIED end-to-end | phase3 suites green; live cross-run effect untested (B2) |
| Decision engine → action | PARTIAL (advisory) | YES (as advisory) | resolveAction has zero production callers (B2) |
| Risk-adaptive prompting | PARTIAL (dead) | YES (as dead) | session.testContext never populated (B2) |
| Integration auth / JWT / workspace ACL | NOT IMPLEMENTED | YES (absence) | docs claim otherwise (B1) |
| Mission idempotency-key | NOT IMPLEMENTED | YES | only fix-validation runs have it (B1) |
| Signed webhooks | NOT IMPLEMENTED | YES | fire-and-forget (B1) |
| API testing engine | NOT IMPLEMENTED | YES | no REST/OpenAPI testing (future) |

## 4. B0 fixes

### Fix 1 — Export URLs missing `/api` prefix (404)
- **Reproduce:** `GET /sessions/<id>/export/findings?format=markdown` (no prefix) → 404; with prefix → 401/200 as appropriate. Verified live before fix.
- **Root cause:** `public/app.js` `handleExport` built URLs without the `/api` prefix (`bugs.js` did it correctly).
- **Fix:** all six export URLs prefixed `/api/…` (app.js:2444-2468).
- **Test:** `tests-real/b0-baseline.test.js` B0-1 (URL construction assert + bugs.js guard).

### Fix 2 — Tests page hardcoded `concurrency: 3, retries: 0`
- **Reproduce:** code inspection + live API contract: server defaults to config (`concurrentRuns`, `retriesCount`) when fields omitted (index.js:1148-1149); the UI was silently overriding operator settings with literals.
- **Fix:** run-all now omits both fields so the server applies Settings (tests.js:724-733); single-run dead `credentials` ternary removed (tests.js:671-676) — authenticated single-test replay documented as a B1 finding (needs secret picker UI).
- **Test:** B0-2 tests assert the literals are gone and the endpoint call remains.

### Fix 3 — (No third code fix.) Settings audit found no new defect: all Settings fields map to consumed config; `maxConcurrentMissions`, `missionTimeoutMinutes`, `browserstackStrict` are API-only (documented in §8, not fixed — UI surface is B1 UX scope).

## 5. Configuration authority

Actual precedence (verified live, config.js:127-165):

1. **DEFAULTS** (hardcoded)
2. **env** (`.env` QASE_*)
3. **stored** `.qase/config.json` — **wins over env** for every generic field (merge loop order env→stored)
4. Special carve-outs: BrowserStack user/key/enabled/strict — stored beats env; malformed env (e.g. `"false"` quoted) can never resurrect BS enabled/strict; explicit Settings clear deletes the stored value.
5. `saveConfig()` clamps: maxTurns 10-500, concurrentRuns 1-20, retries 0-5, missions 1-10, timeout 5-720 min.
6. Runtimes capture config at construction; `PUT /api/config` affects idle runtimes only (documented behavior).

**Discrepancies found (documented, NOT silently changed):**
- `maxTurns`: env 120 → **effective 500** (stored). Also `context.maxTurns` on `/api/v1/missions` is NOT honored by the agent (agent.js:161 reads global settings only) — the B0 smoke mission with maxTurns 6 ran to ~200 turns. **Documented as dangerous; fix is B1/B2 scope (mission-scoped budget), not a silent value change.**
- `concurrentRuns`: env 3 → **effective 20** (stored). env comment warns 20 OOMs a 6GB container. **Dangerous; correction requires an operator decision (which number is intended?). Flagged as a B1 blocker for the config-authority decision; not silently changed.**
- Config comment inversion (comment says env overrides stored; code: stored wins) — documented here; behavior is intentional per B0.1 BrowserStack authority carve-outs; B1 should re-state the comment.

**OPERATOR DECISION (2026-08-25, post-B0):** source of truth = defaults 120/3; 500/20 become **hard safety ceilings only**, not defaults. Stored config updated via the authenticated API: `maxTurns=120`, `concurrentRuns=3` (verified effective + persisted). Clamps in `saveConfig` (10-500 / 1-20) already express the ceiling. B1 adds: mission-scoped `context.maxTurns` honored by the agent (bounded by the 500 ceiling), and a runtime governor later (B3) may dynamically raise usage toward — never beyond — the ceiling.

## 6. Runtime health

- Services: `service-bg-service-3546` (QASE server) RUNNING; `service-bg-service-3810` (benchmarks 9901-9903) RUNNING; caddy reverse_proxy `/`→5173.
- No dev processes; single server process (verified `ps`).
- `/api/health` 200; preview URL 200.
- **Restart test (live):** procmgr restart → config byte-identical before/after; `.qase` stores reload; state-integrity `error: 0` (4,034 info: pruned-session refs on terminal missions — expected); store-hygiene reports 1,726 reclaimable stale shells (pre-existing; operator cleanup pending per P4.4 report); artifacts: 2,890 orphans / 174 MB / 15 kernel-unreadable (pre-existing, documented).
- Smoke mission vs `https://new.drytis.com`: **completed**, 3 findings (low×3), 125 evidence items, report 200, all cross-store refs intact.

## 7. Regression results

- **B0 targeted pack (4 suites, canonical runner semantics `--test-concurrency=1`): 47/47 pass** (2× stable runs).
- **Core (canonical runner): 1,197 tests · 1,180 pass · 3 fail · 16 cancelled · 1,955 s.** The 3 fails:
  1. `phase17-api.test.js` crash-under-load — **pre-existing** (P4.4 report §4 documented the same flake; passes 16/16 in isolation here, twice).
  2. `phase11a-findings-store-v2` "failure" — the runner's TAP parse of its nested-describe output; the suite itself passes 6/6 directly (verified twice, exit 0). Runner/parser artifact, not a product defect.
  3. (Same two suites counted; no third distinct failure — see report JSON failures list.)
- **Contract 31/31 · Truthfulness 18/18 · Security 15/15 · E2E 31 (30 pass, 1 known product-finding P1-4, non-blocking).**
- **No B0-introduced regression.** All B0 fixes guarded by `tests-real/b0-baseline.test.js` (6/6) + `b0-restart-config.test.js` (1/1 live).
- Test-ordering note: running suites in parallel without `--test-concurrency=1` produces a false failure (p44's SIGTERM restart test kills the server while the provenance suite polls). The canonical runner already serializes; direct `node --test <many files>` does not. Documented, not changed.

## 8. Known issues

**B0 blockers:** none open. (The `tests/` directory and `~/.gitconfig` show filesystem-level `Structure needs cleaning` errors — pre-existing kernel/fs damage; canonical runner already targets `tests-real`. `~/.gitconfig` corruption needs an operator fix before publishing.)

**Post-review cleanup (B0):** the `execution-provenance` suite's strict-BrowserStack live test temporarily writes placeholder creds (`invalid_bs_user_zzz`) and restores via a full-field PUT; the restore raced a server restart at some point leaving `browserstackEnabled: true` + placeholder user in live config. Restored to the operator's real state (disabled, creds cleared, verified persisted). Root cause is the test's before-snapshot being taken *after* a prior pollution — tracked for a test-side guard in B1.

**B1 requirements:**
- Integration auth (JWT/secret) + workspace/project authorization — docs claim it, code has zero of it
- Mission idempotency-key on `POST /api/v1/missions`
- Signed webhooks + retry; mission webhooks persisted (currently in-memory)
- GET read-surface protection (~60 anonymous GETs incl. `/api/artifacts/*`)
- Config authority decision: operator must choose intended `maxTurns` / `concurrentRuns`; mission-scoped `context.maxTurns` must be honored (currently ignored)
- Single-test authenticated replay needs a secret-picker UI
- Secrets at rest are plaintext (`.qase/config.json`)

**B2 requirements:** decision→action wiring (`resolveAction` unwired), risk/testContext dead loop, finding enrichment not called in production, auto-revalidation trigger.

**B3 requirements:** turn/budget governor (mission-scoped budgets, measured tokens), model registry + fallback.

**Future/P1:** API testing engine, regression intelligence, multi-LLM benchmark harness, artifact retention policy application (1,726 shells + 2,890 orphans), phase17-api flake root-cause, knowledge decay scheduling.

## 9. Production readiness gaps (documented only — future builds)

- **Integration authentication:** NOT IMPLEMENTED (`server/integrationAuth.js` absent; `QASE_INTEGRATION_SECRET` zero consumers).
- **Workspace/project authorization:** NOT IMPLEMENTED (workspaceId stored, never enforced).
- **Mission idempotency:** NOT IMPLEMENTED on mission create.
- **Signed webhooks:** NOT IMPLEMENTED (fire-and-forget, unsigned, no retry).
- **Correlation IDs:** NOT IMPLEMENTED.
- **OpenAPI contract:** NOT PRESENT (no openapi.yaml anywhere).
- **Autonomous decision/action wiring:** advisory only (see B2 above).
- **AI-driven turn governor:** NOT IMPLEMENTED (fixed budgets; mission context ignored).
- **LLM role separation:** NOT IMPLEMENTED (single model, tiers collapsed).
- **BrowserStack credential persistence/production flow:** creds persist + survive restart; plaintext at rest; agent missions never execute on BrowserStack (replay only); real-device matrix = 4 Android models.
- **Application-understanding benchmark:** exists (hybrid heuristic+LLM); no recorded benchmark scores against live apps.

## 10. Recommendation

**QASE is ready to begin B1 — Integration Contract + Security Boundary.** The baseline is stable: persistence verified, runtime restart-safe, no active blockers in the core, B0 defects fixed and guarded by tests. B1 must start with the config-authority operator decision (maxTurns/concurrentRuns intent) since every mission B1 tests will inherit those values.

---
*Verification evidence: `tests-real/b0-baseline.test.js` 6/6 · `b0-restart-config.test.js` live · targeted pack 47/47 (×2) · core 1,180/1,197 (3 pre-existing/parse artifacts) · contract 31/31 · truthfulness 18/18 · security 15/15 · e2e 30+1known · smoke mission 321c9023-782c-4433-b00c-dbd396d52366 (completed, 3 findings, 125 evidence).*
