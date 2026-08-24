# M1-P3 — ARCHITECTURE AUDIT (Phase 0 — inspect only, no code changed)

Audited: `server/` 65 modules / 29,592 lines, main @ 4eb617c, live server on :5173.
Every claim verified against code with file:line, and against the live `.qase/` stores
(sizes: sessions.json 33.4 MB / 50 sessions, evidence-graph.json 29.0 MB parseable payload
(38,882 evidence / 1,938 observations / 15,277 edges), missions.json 10.3 MB / 2,435 rows,
artifacts/ 217 MB / 3,761 run dirs, findings.json 7.2 MB / 2,942, fix-validations.json 4.0 MB
/ 500 (FIFO cap), replay-runs.json 2.3 MB / 3,760, test-cases.json 358 KB / 501,
schedules.json 14 rows, config.json mode 0600).

## 1. Server startup & lifecycle

- express() (v5) → `express.json({limit:'1mb'})` → **`app.use(setAuthCookie)` (index.js:95, GLOBAL)** → `express.static(public)` (index.js:96).
- `/api/artifacts/:runId/:filename` mounted at index.js:100-115, before any auth, regex-guarded path traversal, `Cross-Origin-Resource-Policy: cross-origin` (index.js:108).
- Boot: mountDemoSite (118) → loadSessions (120) → startScheduler (122) → startWatchdog (123) → resource cleanup immediate + 30-min interval (165-166) → ensureDefaultProject / assignOrphanedEntities / migrateFromSessions / loadMissionsFromDisk (2653-2668) → missionBus listener (2672) → app.listen (2678).
- Watchdogs: store watchdog 60 s / 30-min max running (store.js:269-298, running→interrupted); agent timers 20-min turn / 5-min LLM-idle ×2 retries (agent.js:25-45).
- **SIGINT/SIGTERM handler EXISTS** (index.js:2637-2650): aborts sessions, closes browsers, exit(0). **Gap: it never flushes the debounced store writers** — persistSoon timers (250 ms; missions 500 ms) mean the last ≤250-500 ms of any mutation is silently dropped at shutdown. No `server.close()`/drain.

## 2. API routing architecture

- index.js: 119 routes; phaseRouter.js: 34 routes mounted ONCE at index.js:1280 under `/api` with its own `router.use(auth)` — mounted BEFORE legacy findings block so `/api/findings/grouped` wins over `/api/findings/:id`.
- Auth is per-route (`requireApiToken` as 2nd arg), never tiered. All POST/PUT/DELETE gated **except `PATCH /api/findings/:id/status` (index.js:1382 — unauthenticated mutation)**. Most GETs open (single-tenant posture, documented).

## 3. Mission/execution lifecycle

- Create: POST /api/v1/missions (index.js:1565-1687) — targetUrl validated, testCredentials → in-memory vault, device validated pre-create (400), createMission, autoStart→ createSession + knowledge hints + startTurn, 202.
- Start/revalidate/iterate on phaseRouter + index.js with 409 terminal/running guards.
- Agent loop agent.js:313-610: AbortController, stream events, retryable model-timeout recursion (≤2), end states done/awaiting_input/idle. maxTurns clamp 10-500 (config.js:262-264); **live value 500**.
- Finalization is dual-path: capability pipeline (capabilities.js:476-539 → missionBus 'finalized' → webhooks) AND lazy GET-poll finalize (index.js:1771-1787 → finalizeMissionFromSession with honesty guard 2415-2431). `finalizeMission` is idempotent (terminal no-op, missions.js:252-255).
- **Dead event**: missions.js:267 emits `'mission:finalized'` but the only listener subscribes `'finalized'` (index.js:2672) — bus-driven webhooks never fire from `finalizeMission()`; only the two direct call sites do. Webhook registry is an in-memory Map — lost on restart.

## 4. Session/state persistence

- store.js: STATE_DIR = **cwd**/.qase (store.js:16) — vs missions/testCases/replayStore/scheduler which are **module-relative**; findings/evidenceGraph use `QASE_DATA_DIR ?? cwd`. Three path conventions coexist; running from a different cwd forks the store.
- persistSoon 250 ms → atomicWrite (store.js:28-38). emit() (store.js:172-178) triggers a **whole-file rewrite of the 33 MB file on every non-ephemeral event**.
- Boot recovery (store.js:40-60): running/awaiting_input → interrupted. Parse failure → **silently empty** (store.js:59-60).
- pruneOldSessions(50) (store.js:101-112) is **count-based**; 50 heavyweight sessions ≈ 33 MB — the M1-P2 RL-1 product finding.

## 5. Finding persistence

- findings.js:24-27, load LOUD on corruption (findings.js:38-60, references 2026-08-16 incident), persistSoon→atomicWrite.
- addFinding (findings.js:214-283): caller confidence never trusted; finding_status/review_status never accepted from input; severity validated. 38-key schema.
- Dedup is **findingIntelligence.js:575-630** (jaccard 0.90/0.62 + error-signature corroboration). `duplicateSuppression.js` is dead server code (only tests import it).

## 6. Test-case persistence

- testCases.js → test-cases.json, atomic, silent-empty on parse failure, no size cap. Runs: replayStore.js FIFO 50 per case, atomic. runTestSuite (replay.js:1041-1162): pool concurrency 3, cartesian viewports×browsers, per-result executionEnvironment provenance.

## 7. Evidence/artifact persistence

- evidenceGraph.js:147-148 DATA_DIR cwd-relative. **persist is copy-not-rename** (evidenceGraph.js:194-195): `writeFileSync(tmp, JSON)` then `writeFileSync(GRAPH_FILE, readFileSync(tmp))` — a crash mid-copy truncates the 29 MB store; loadFromDisk then **silently resets to empty** (evidenceGraph.js:173-175). The doc comment at :179 says "atomic write" — the comment lies.
- Reads are full O(n) scans per request (evidenceGraph.js:303-396).
- Artifacts: replay persists screenshots/traces under `.qase/artifacts/:runId/` (217 MB); **agent missions persist NO screenshots** (SSE-ephemeral frames only; browserBridge.js:510-546, `frame` ∈ EPHEMERAL store.js:166). runIds enumerable via public `GET /api/test-cases/:id/runs`.

## 8. Fix-validation persistence

- fixValidation.js:20 STORE_PATH, FIFO 500. **persistNow is a plain non-atomic `fs.writeFileSync` (fixValidation.js:46)** — violates the project's own atomicWrite policy; 4 MB audit store can corrupt.
- classifyFixStatus (fixStatusEngine.js:231-292) fully deterministic; MIN_VERIFIED_ATTEMPTS=2 (fixStatusEngine.js:99). **2 live runs stuck QUEUED** block new validations for their findings (409 active-check phaseRouter.js:395-398) forever after a crash — no reaper.

## 9. Scheduler / background jobs

- scheduler.js: 60 s tick, runningScheduleIds re-entry guard, executeSchedule fire-and-forget, nextRun recomputed after completion (drift), regression results into regression-runs.json (cap 200, atomic).
- Restart: stale `nextRun < now` fires exactly once on first tick (catch-up-lite) — acceptable, undocumented. **Credentials stored plaintext in schedules.json** (scheduler.js:136).

## 10. Authentication / token handling

- requireApiToken (index.js:203-223): Bearer or qase_token cookie, timingSafeEqual; **if no token configured → next() (everything open)**.
- **setAuthCookie (index.js:230-240, mounted globally at :95) sets `qase_token=<FULL mutation token>` on ANY response where the cookie is missing/mismatched — including anonymous GET /**. HttpOnly+SameSite but the value IS the bearer token; also missing `Secure`. Combined with the unauth'd PATCH (§2), the token gate is cosmetic for anyone who can reach the origin.
- The SPA itself only *reads* the cookie (app.js:965, executionDetail.js:306/399) as a convenience — the server-sent cookie is not required for the UI to function if the user sets a token manually (localStorage fallback exists). SSE and artifacts endpoints are unauthenticated.

## 11. Browser/device execution abstraction

- resolveLaunchPlan (replay.js:91-146): BrowserStack only when enabled+creds; unsupported device → deterministic 400, NEVER substitutes; strict mode (default) throws BrowserStackStrictError with **no local fallback**; non-strict fallback is loud + tagged `fallbackFrom`.
- browserstackTest.js: 2-stage probe (auth API + CDP handshake), key never echoed.
- deviceContext.js: real-device registry = Pixel 8/7/5, Galaxy S9+ only. executionEnvironment.js: buildExecutionEnvironment throws on unknown provider; isRealDevice = browserstack ∧ device ∧ ¬engineEmulated.
- **Agent missions NEVER use BrowserStack** — local Chromium only, device requests honestly labeled EMULATED_DEVICE (agent.js:219-306). Replay may use BrowserStack. This split is by design and truthful.

## 12. AI/LLM integration boundaries

- One provider config (live: custom → llm.drytis.ai/v1, z-ai/glm-5); two call surfaces: SDK runtime (agent loop) and callLLM (testGen.js:121-186, 120 s timeout, 2 transient-only retries).
- Deterministic overrides verified in place: severity correction + security floor (findingIntelligence.js:201-260), P0 gate (269-309), verdict via calculateMissionQuality (devIntelligence.js:267-379), finalize-time honesty guard (index.js:2415-2431 — error/interrupted session can never surface as pass), fix-status derivation (fixStatusEngine.js:231-292 — LLM may never select), finding lifecycle/confidence never caller-trusted, dedup identity corroboration.
- No raw LLM output persisted (grep verified); persisted only post-parse/clamp.

## 13. Error handling

- errorTypes.js (PipelineError/classifyError/withRetry) used by replay/selfHeal/validation — NOT by the express layer. Route layer is per-route try/catch; error shape mostly `{error}`; 14 × status(500) sites return `error.message` (internal paths/upstream bodies can leak — P2); no stack traces. Counter-example done right: browserstack test endpoint generic internal_error (index.js:343-347).

## 14. Configuration handling

- config.js: DEFAULTS ← env ← stored; BrowserStack stored-beats-env authority rule; clamps; atomicWrite mode 0600. **Plaintext secrets in config.json** (apiKey, apiToken, browserstackUser/Key) — mitigated by file mode only. `getPublicConfig` redacts keys but **returns `browserstackUser` in full** (config.js:217) via public GET /api/config.

## 15. Existing API contracts

- Mixed versioning: `/api/v1/*` family vs unversioned core CRUD; duplicate verbs (`/api/findings/:id/revalidate` Phase 16 vs `/api/v1/findings/:id/revalidate` Phase 18 — same verb, two meanings); alias route rewrites req.url (phaseRouter.js:408-411).
- Response envelopes mixed: bare arrays (sessions, findings, test-cases, missions lists) vs named envelopes ({missions}, {runs, metrics}, {missionId, evidence, total, limit, offset}).
- Pagination only on evidence family (limit cap 500 / offset); **two pagination bugs**: `total` from a second unbounded full query (index.js:2170) and `total` computed after slicing at index.js:2269/2285 (always equals page size). Everything else returns whole stores (2,942 findings, 2,435 missions per request).
- Idempotency-Key honored only on fix-validation revalidate; missions store idempotencyKey but never check it at create.

## 16. Data-flow Mission → Execution → Evidence → Finding → Validation → Report

Traced end-to-end, 19 hops, all file:line-cited (createMission missions.js:102-161 → session/vault index.js:1617-1629 → knowledge injection 1641-1656 → prompt 2362-2393 → agent turn agent.js:313-610 → capturedSteps workflows.js:136-245 → report_finding qaTools.js:21-128 → findings.js:618-676 → finish_qa_report → pipeline capabilities.js:476-539 → recordIteration missions.js:319-355 → finalizeMission 248-269 → lazy finalize + honesty guard index.js:2409-2530 → evidence collect evidenceGraph.js:1004-1107 → UX assessment → webhooks index.js:2536-2561 → report 2126-2153 → fix-validation phaseRouter.js:385-406 / fixValidation.js:94-236 / validationExecutorCore.js:225-388 → approve/reopen 440-481).

**Cross-cutting integrity finding**: 57 of 71 `running` missions are **zombies** — their session was pruned before lazy finalization could run, so they poll `running` forever and never receive the honesty guard. Oldest from 2026-08-17.
