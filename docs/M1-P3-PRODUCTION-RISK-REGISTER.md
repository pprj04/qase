# M1-P3 — PRODUCTION RISK REGISTER (Phase 1)

Severity: **P0** = can corrupt data / produce false results / lose evidence / bypass security /
make production execution unreliable. **P1** = significant operational problems / API instability.
**P2** = maintainability/documentation. Each entry: evidence (file:line or live-store proof),
impact, and disposition for this build (FIX NOW = smallest safe fix in Phase 3;
DOCUMENTED = deferred with owner phase).

## P0

| # | Risk | Evidence | Impact | Disposition |
|---|---|---|---|---|
| P0-1 | **Evidence graph written non-atomically (copy-not-rename) + silent reset on load failure** | evidenceGraph.js:194-195 (`writeFileSync(GRAPH_FILE, readFileSync(tmp))`), :173-175 (`catch { Fresh start }`) | Crash mid-write truncates the 29 MB evidence store; next boot silently resets to EMPTY — total evidence loss, no error, ever. Directly contradicts atomicWrite.js policy and its own comment (:179). Prior corruption incidents on this volume documented in .drytis/notes/. | **FIX NOW** (swap copy→rename + loud load failure). Lowest-risk, highest-value fix in the register. |
| P0-2 | **fix-validations.json written non-atomically** | fixValidation.js:42-50 plain `fs.writeFileSync` | 4 MB deterministic fix-validation audit trail (the VERIFIED_FIXED/STILL_BROKEN evidence of record) corrupts on crash → FIFO store loads empty → audit history lost. | **FIX NOW** (atomicWrite swap). |
| P0-3 | **Shutdown drops the last ≤250-500 ms of ALL store mutations** | index.js:2637-2650 SIGTERM handler never flushes persistSoon timers (store.js 28-38, missions.js 67-82, fixValidation.js 52-56, findings.js 62-81, evidenceGraph.js 181-201, testCases.js 42-58, replayStore.js 32-42, scheduler.js 47-57) | Any finding/mission/session/validation written in the final debounce window before restart/redeploy is silently lost. | **FIX NOW** (flush hooks + SIGTERM call). |
| P0-4 | **57 zombie `running` missions — no mission restart recovery + session pruning strands missions** | missions.js:54-65 (plain load, no sweep) vs store.js:101-112 (prune); live store: 71 running, 57 with missing/pruned sessions (verified 2026-08-23) | API consumers poll forever (never terminal); `GET /api/missions` reports 71 "running" that are dead — reporting-truth violation; honesty guard can never run for them. | **FIX NOW** (boot sweep marking orphaned running missions interrupted with reason; smallest-safe: no schema change). |
| P0-5 | **`setAuthCookie` grants the full mutation token to every visitor** | index.js:95 (global mount) + 230-240; cookie value = raw bearer token | Anyone reaching the origin (including anonymous page loads) receives full mutation rights for 24 h. Combined with P0-6 the auth gate is cosmetic in practice. | **FIX NOW** (remove auto-grant; UI already has localStorage fallback + Settings shows the token for manual paste — same-origin demo UX preserved). Security posture > silent token broadcast. |
| P0-6 | **Unauthenticated mutation route** `PATCH /api/findings/:id/status` | index.js:1382-1389 — no requireApiToken | Anonymous lifecycle changes on any finding (open→resolved etc.). | **FIX NOW** (add requireApiToken — one word). Check SPA doesn't call it unauthenticated (app.js api wrapper sends Bearer when present). |
| P0-7 | **Stuck fix-validation runs never reaped** | fixValidation.js has no boot sweep; live: 2 runs QUEUED since crash; phaseRouter.js:395-398 409-blocks new validations for those findings | Permanent 409 for affected findings after any crash mid-validation. | **FIX NOW** (boot sweep: non-terminal runs → FAILED with reason 'interrupted_by_restart'). Matches session-interrupted semantics; deterministic engine untouched. |

**Deferred P0s (documented, larger than this phase — STOP condition respected):**
- D-1 SSRF: mission `targetUrl` unvalidated (index.js:1569, extractUrl 242-256) → internal network via agent page.goto; artifacts CORP cross-origin (index.js:108); open SSE. Needs allowlist design + per-project policy → **M1-P5 security phase**.
- D-2 No mission concurrency cap / rate limiting (live maxTurns 500, concurrentRuns 20; N missions = N Chromium + N agent loops). → **M1-P4**.
- D-3 sessions.json 33 MB / 50 sessions, whole-file rewrite per event, count-based prune (M1-P2 RL-1 finding). → Phase 5 recommendation here, implementation **M1-P4/P5**.
- D-4 Silent empty-on-parse-failure for sessions/test-cases/replay-runs (evidence/fix-validation get loud failures in this build). → **M1-P4** (store-loader convention change across modules).

## P1

| # | Risk | Evidence | Disposition |
|---|---|---|---|
| P1-1 | Evidence pagination `total` computed AFTER slicing — clients can never page correctly | index.js:2269, :2285 | **FIX NOW** (order swap, no shape change) |
| P1-2 | Evidence `total` via second unbounded full query per request (O(n) sort ×2) | index.js:2170 | **FIX NOW** (reuse the count already computed pre-slice) |
| P1-3 | `browserstackUser` returned in full on public GET /api/config | config.js:217 | **FIX NOW** (mask to hint like the keys; Settings displays maskedUser already for BS verify) |
| P1-4 | Caller-supplied mission `id` silently overwrites existing mission | missions.js:103 (data.id honored), index.js:1505-1508 | **FIX NOW** (reject non-UUID / colliding id with 409) |
| P1-5 | Dead event name: `'mission:finalized'` emitted, listener on `'finalized'` — bus webhooks never fire from finalizeMission() | missions.js:267 vs index.js:2672 | **FIX NOW** (emit both names — backward compatible, zero-risk) |
| P1-6 | Webhook registry in-memory — lost on restart | index.js:2338 Map | DOCUMENTED → M1-P4 (needs persistence decision) |
| P1-7 | Schedules store credentials plaintext | scheduler.js:136 | DOCUMENTED → M1-P5 (vault integration) |
| P1-8 | missions.json unbounded (2,435 missions, iterations store full findings arrays, pretty-printed) | missions.js:67-82, 319-355 | DOCUMENTED → M1-P4 (archival, mirrors sessions) |
| P1-9 | fix-validation FIFO truncation can orphan findings' `lastValidationId` pointers (none today) | fixValidation.js:195-236 vs cap 500 | DOCUMENTED → M1-P4 (pointer check on truncation) |
| P1-10 | Store base-path conventions split (cwd vs module-relative vs QASE_DATA_DIR) | store.js:16, missions.js:26, evidenceGraph.js:147, findings.js:24 | DOCUMENTED → M1-P4 (single resolver) |
| P1-11 | Store watchdog marks sessions interrupted but a pruned-session mission still relies on lazy GET finalize; pollers on zombie missions (see P0-4) | store.js:269-298 | RESOLVED BY P0-4 |
| P1-12 | Replay-run store tolerates duplicate ids from test fixtures writing into the LIVE store (153 rows from phase9c fixture ids) | replayStore.js:57-73; phase9c writes shared .qase | DOCUMENTED → M1-P4 test-isolation |
| P1-13 | Agent `BROWSER_IDLE_MS = 0` makes browser idle-close branch dead code (Chromium persists between turns) | agent.js:23, 591-598 | DOCUMENTED (behavior acceptable; note for cost phase) |

## P2

| # | Risk | Evidence | Disposition |
|---|---|---|---|
| P2-1 | 14 × status(500) return internal error.message (paths/upstream bodies) | index.js:607,663,891,1049,1089,1134,1186; phaseRouter.js:379 | DOCUMENTED → M1-P6 API phase (error envelope standard) |
| P2-2 | Mixed response envelopes / duplicate verb semantics (revalidate ×2) | audit §15 | DOCUMENTED → M1-P6 |
| P2-3 | duplicateSuppression.js is dead server code (tests-only importer) | researcher grep | DOCUMENTED (kept — tests import it as oracle) |
| P2-4 | Dead event-name gap class bugs: missionBus emit covered in P1-5 | — | resolved with P1-5 |
| P2-5 | evidence-graph.json.tmp left behind after crash never cleaned | evidenceGraph.js | resolved implicitly by P0-1 fix (unlink after rename) |

## Explicitly NOT touched (protected / out of scope)

- fixStatusEngine / fixValidation logic / findingIntelligence semantics / phaseRouter workflows — no P0 requires changing them (P0-2/P0-7 are persistence-layer only).
- UI redesign, OpenAPI, multi-tenancy, SSRF allowlist, store migration — later phases.
- No test assertions weakened; protected suites untouched except where a fix changes the
  *behavior under test* in the direction the test already demands (e.g. unauth'd PATCH
  becoming 401 — verified against the security-detection suite which MEASURES the open
  route as a known risk; that suite is advisory and documents the before-state).
