# Forensic report — production complaints 1–7 (Areas A–F)

**Date:** 2026-09-03 · **Ticket:** #8989 · **Read-only investigation; no production behavior changed.**
Probe artifacts created & deleted (schedule `faa16685`, test case `55d4b2e1`, regression run `053b0523`). Baseline HEAD `54687b6` untouched.

## Complaint 1 — "Different users can see runs started by other users" — **CONFIRMED, P0**

**Root cause:** QASE storage is **single-tenant with no per-user data isolation**. There is no user identity in any store.

| Layer | Evidence |
|---|---|
| Storage | `server/store.js createSession()` — session record keys: `id,title,projectId,createdAt,updatedAt,status,targetUrl,messages,activities,findings,todos,…` — **no userId/ownerId**. Live store: 0/7 rows carry any user field. Missions (`missions.js`), findings, evidence — same shape |
| API | `app.get('/api/sessions')` (index.js:878) → `listSessions({projectId})` — only filter is `projectId`. Same for `/api/missions` (index.js:1934), `/api/findings` (index.js:1920) |
| Auth | `requireApiToken` (index.js:345) has identity (`request.auth = {kind:'user', userId, role…}`, index.js:395) but **no route uses it to scope reads**; all reads return the entire workspace. UI sessions, master token, and integrations all see everything |
| SSE | `/api/sessions/:id/events` (index.js:1872) is per-session (`bus.on(session.id)`) — **not** broadcast; a user needs the session id. But session ids are enumerable via the global `/api/sessions` list any authenticated user can call, so isolation is effectively nil |
| Workspace | `workspaceId` exists ONLY for integration principals (integrationAuth.js; `upsertIntegration` stamp, index.js:2152/2383) and is a label on missions — it never scopes reads or queries |
| Anonymous | `QASE_AUTH_MODE` unset → default `required`, but live checks: `GET /api/sessions` → **200 anon**, `GET /api/v2/findings/stats` → **200 anon** → server effectively open (state D3 verified live; master token exists but reads are open to callers without a token via public-read posture) |
| Team | 6-member project (owner + admin/ops/viewers) — every login sees every run, mission, finding, bug, schedule, and session stream |

**Reproduction:** (1) log in as viewer A; GET /api/sessions → full list including operator B's runs. (2) Open B's run → SSE stream + report + evidence all render. No 403 anywhere in the read path.
**Minimal fix:** add `ownerId` to sessions/missions/findings at creation; filter list routes by `request.auth`; require ownership (or role admin) on session detail/SSE; decide + document tenancy model (shared-workspace vs per-user).
**Regression test:** two-user isolation test (user A creates run; user B lists → does not see it; direct GET/SSE on A's id → 403). Deterministic, child-server based.

## Complaint 2 — "Runs sometimes freeze" — **CONFIRMED, P1 (multi-cause)**

Four independent freeze mechanisms:

1. **`closeOtherBrowsers` closes paused runs' browsers (agent.js:222, called at every `startTurn` via :553).** It closes every session browser whose `liveFor(id).running` is false — but `awaiting_input` sessions have `running:false` (record.running false at the pause; store.js runWatchdog skips non-running). With the governor's 3 parallel slots, starting turn N+1 of mission X **closes the browser of mission Y paused at a question**. When Y resumes, the bridge/page is gone → screenshot loop throws each tick (browserBridge.js:526 catch swallows) → UI shows stale frame / "No browser yet" while activity keeps streaming. **Also directly produces complaints 3 & 7.**
2. **Integration created-missions never auto-start & never expire (index.js:2102 `autoStart: body.autoStart !== false`; UI never calls /start — app.js:2039 has no `/start` call).** 2,833 missions sit in `created`, 2,603 older than 7 days. From the UI these look frozen ("stuck at Created").
3. **Model-silent idle → `idle` status (agent.js:887)**: after retries the session settles `idle` with no report — a run that "stopped by itself".
4. **Heavy list endpoints over 29MB missions.json / 16MB findings.json**: /api/findings 156ms, /api/missions 172ms — fine server-side, but the UI renders 7,914 finding cards in one DOM (audit B) → browser-side freeze; backend not the bottleneck (node RSS 292MB, 0.7% CPU).

**Reproduction:** (1) start mission A → pause at question (awaiting_input) → start mission B → A's Chromium is killed by B's turn-start sweep; answer A's question → frozen browser panel. (2) Create a mission with autoStart:false from the UI intent form → never starts, no timeout.
**Minimal fixes:** skip sessions with status `awaiting_input` in `closeOtherBrowsers` (or gate on bridge page presence, not running); auto-start or expire created shells; batched/paginated UI lists.
**Regression tests:** paused-browser-survival test (A paused, B starts, A's bridge still has page), created-shell expiry test.

## Complaint 3 — "Runs unexpectedly show INTERRUPTED" — **CONFIRMED, P0 (unexpected to users; honest to the machine)**

`INTERRUPTED` is a **backend truth-teller with four writers**; it does NOT mean data loss — but it fires on events users don't associate with interruption:

| # | Writer | Trigger |
|---|---|---|
| 1 | `loadSessions()` (store.js:66) | **server restart** — any `running`/`awaiting_input` session flipped to `interrupted`, question dropped |
| 2 | `runWatchdog` case 1 (store.js:445) | stuck: status running but record.running false |
|  INTERRUPTED is not a UI artifact |
| 3 | `runWatchdog` case 2 (store.js:454) | >30 min max running duration |
| 4 | R2-A expiry (store.js:415-429) | awaiting_input > configured 60-min timeout |

**Live specimens:** (a) session `396edfcf` (studio.drytis.ai) — `ask_question` done at 14:26:23.833Z, disk write 14:26:23.835Z → **server restarted 2ms later**: boot sweep flipped awaiting_input→interrupted, dropped the question; stale `awaitingInputSince` left behind (R2-A residue bug — expiry handler never ran for a boot-flipped session). It has 28 msgs / 76 activities / 2 findings preserved, no missionId on the session, and the v1 session GET exposes **no pendingQuestion and no reason field** — the user saw "INTERRUPTED" with no explanation. (b) 109 interrupted missions in store. (c) sessions.json currently holds 1 interrupted / 5 done / 1 idle.
**INTERRUPTED is always backend**, never an SSE-disconnect label: SSE close only detaches listeners (index.js:1898-1901); no code path writes interrupted on socket close.
**Reproduction:** ask a question via UI → restart server → status flips to interrupted; question is unrecoverable (pendingQuestion hidden by projections at index.js:1014/1033/1065 — only inline where status==='awaiting'.
**Minimal fixes:** expose `interruptedReason` (mission.interruptedReason exists at missions.js:504; sessions lack the field — add it to setStatus writes); surface pendingQuestion in v1/v2 session projections for interrupted sessions (so users see what was asked); clear `awaitingInputSince` on boot flip (fix residue).
**Regression tests:** restart-during-awaiting_input preserves question text and exposes reason; API projection includes interruptedReason.

## Complaint 4 — "Cannot tell whether evidence was actually collected" — **CONFIRMED, P1**

**Pipeline (fully traced):** mission → `ensureRuntime` (agent.js) → SDK runtime + `attachBrowserBridge` (browserBridge.js:58) → every tool call → `record.onToolStart` = `beginActivity` (agent.js:640) → `addActivity` (persisted, sessions.json) + `captureStep` (structured workflow step) → at finalize `recordIteration` → `buildIterationEvidence` (evidenceGraph.js:~1100): **(a)** each capturedStep with an outcome → `step_outcome` evidence node; **(b)** each finding with `.evidence` text → `finding_detail` node + `SUPPORTS` edge to the finding; **(c)** screenshots/DOM: **`browser_screenshot`/`browser_snapshot` tool calls become step_outcome nodes only — no screenshot bytes anywhere in the graph**; replay-path screenshots (replay.js:39/502) write JPEG artifacts to disk, never into the graph.
**Store truth (51,262 evidence nodes / 23,745 edges):** step_outcome 44,721 · finding_detail 3,596 · screenshot 2,063 (all from fix-validation & uxChecks sources, payload null — metadata-only) · observation 715 · console 50 · assertion 117. **3,476 nodes carry missionId:null (orphans).**
**Where evidence is lost/silent:** (1) **`finding.evidence` is free text typed by the model** — a finding reported without an evidence string generates NO finding_detail node → zero typed evidence on that bug; 0/7,979 findings carry evidenceIds in the findings store (links live only in graph edges, so the Bugs page shows "No typed evidence linked" for most findings — app.js:900); ( evidence graph **debounced 500ms** — SIGKILL-class deaths drop the tail; (3) SSE frame stream (320ms JPEG) is transient only — never persisted.
**Structured counters: MISSING.** No per-run counters exist anywhere (confirmed: no evidenceCount field on regression runs, sessions, or missions; /api/v1/missions/:id/evidence-coverage exists but reports coverage %, not attempted-vs-persisted).
**Reproduction:** open any recent completed run's findings in the Bugs hub → most show "No typed evidence linked to this finding in the evidence graph."
**Minimal fix:** per-run evidence counters (screenshots_attempted/persisted etc.) stamped at finalize + surfaced in run header; persist screenshot bytes (or artifact refs) for browser_screenshot steps; write `evidenceIds` onto findings at linkage time.
**Regression test:** mission with N screenshot steps → counters exact; finding without evidence text → counter shows 0 linked, not silent.

## Complaint 5 — "Schedules configured but never proven to fire" — **CONFIRMED WORKING, with one P0 production failure**

**Lifecycle:** scheduler.js (own tick `setInterval`, **unref'd**, line 301 — survives because the server process lives; started unconditionally at index.js:180 `startScheduler()`) → every 60s `tick()` → for each enabled schedule with `nextRun <= now` & not in `runningScheduleIds` → `executeSchedule` → resolves test cases (`getTestCase`) → `runTestSuite` (replay.js) → `addRegressionRun` (persisted, regression-runs.json) → webhook `notifyTestFailure` → `lastRun` + `nextRun = computeNextRun` persisted (immediate atomic write on mutation + debounced path; both safe).
**Fire proof (today, 2026-09-03):** 11 enabled schedules, ALL 11 fired at 09:00:48Z; log lines `[scheduler] Triggering schedule…` + `complete:`; 200 persisted runs with `trigger:'scheduled'`; nextRun rolled to tomorrow 09:00. Missed-job recovery: nextRun survives restart; missed window fires at next tick after boot (queueing behind `runningScheduleIds` guard → no duplicates within a process; restart during execution could double-run since completion isn't checkpointed — noted, low risk with daily crons).
**Controlled test (live server):** schedule `faa16685` created 19:08:36Z, cron `* * * * *`, 1 test case → **fired at 19:09:56Z** (log: Triggering + complete), run `053b0523` persisted (trigger scheduled), lastRun stamped, nextRun rolled. **Scheduler mechanism: PROVEN.**
**⚠ P0 finding:** the run ERRORED — `BrowserStack execution failed — local fallback was disabled… Invalid username or password`. Config: `browserstackEnabled: true`, `browserstackStrict: true`, user `contact@drytis.com`, key `enc1:…` (decrypts to invalid creds). **All 20 scheduled test rows today errored identically.** Every daily schedule fires and then fails at the browser step. Scheduler ✓, executions ✗.
**Reproduction:** see regression-runs.json `trigger:'scheduled'` rows 2026-09-03 — all `errored:1, passed:0`.
**Minimal fix:** fix BrowserStack credentials or disable browserstackEnabled (one Settings change — env/keys untouched); longer-term add schedule health surface (last N runs pass-rate).
**Regression test:** schedule fires → regression run persisted with evidence → assert run exists and result recorded (independent of BrowserStack).

**evidence_count in the controlled run:** 0 — because the run errored at browser launch (see Area C: no evidence persisted for failed replay runs; screenshots only on failures per replay.js:39).

## Complaint 6 — "Meeting URLs fail: microphone permission/device unavailable" — **CONFIRMED P1: environment, not app bug**

**Launch config (agent.js:296-308):** SDK creates the browser via `createNodeProviderConfiguration` → `CleanSlateNodeAgentRuntime({browserHeadless: settings.headless !== false})`. **No launch flags anywhere** in QASE code: no `--use-fake-audio`, no `--use-fake-device-for-media-stream`, no permission grants. `grep` across agent.js/browserBridge.js: zero hits for `grantPermissions|microphone|getUserMedia|mediaDevices|enumerateDevices`.
**Runtime reality:** container `/dev/snd` absent, no `aplay`/`arecord` → **no audio devices**; headless Chromium in a server container has no mic/camera hardware. WebRTC apps (meetings) in headless Chromium without fake-device flags → `getUserMedia` rejects (NotFoundError / NotAllowedError), exactly matching "meeting URLs fail".
**Classification:** (1) *permission denied* — not configured (Chromium default: mic permission not granted; sites get "denied" unless flags grant); (2) *browser API unavailable* — APIs exist in Chromium, but fail without devices; (3) **no audio device — the actual condition** (no /dev/snd, no fake-audio flags); (4) app-level meeting failure — none proven.
**Minimal fix:** for meeting-target missions, launch context with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` (+ audio-only fake device) or attach real mic via BrowserStack real devices; capability gating ("meeting testing requires media emulation") honest error.
**Regression test:** deterministic: launch headless Chromium with fake-audio flags in CI → `navigator.mediaDevices.enumerateDevices()` returns an audio input → getUserMedia resolves; without flags → rejects. (SDK launch is config-driven; test at the capabilities layer.)

## Complaint 7 — "Agent activity while browser panel says 'No browser yet'" — **CONFIRMED, P1**

**Mechanism:** frames start ONLY at `browser_open` success (agent.js:815 `bridge.startFrames()` on `part.toolName === 'browser_open' && ok && result?.url`) or on turn start if `bridge.hasPage()` (agent.js:546-549). The panel (public/index.html:220) shows "No browser yet" until a frame arrives. Divergence cases: (a) `closeOtherBrowsers` closed this session's browser while paused (complaint 2.1) → activity resumes (tool calls, findings) but `hasPage()` false → no frames → **panel permanently shows "No browser yet" while the agent works** — or worse, works headless on a NEW page the bridge hasn't re-attached (turn-start `startFrames` only fires if `hasPage()`); (b) mission never calls `browser_open` (text-only turns, planning) → by design no frame; (c) after restart-mid-run: record gone, `getLastFrame` undefined → SSE replays nothing → panel stuck at "No browser yet" for a session whose activity log replays.
**Reproduction:** pause A at question → start B → answer A → A's panel: "No browser yet" + activity ticking.
**Minimal fix:** bridge-level page re-attach on resume (startFrames unconditional on turn start when session not settled); UI: distinguish "starting browser…" from "no browser" (loading state) by consuming SSE `frame` presence + session.running.
**Regression test:** paused→resume flow keeps frames flowing (activity event + frame event within N seconds after answer).

## Area F — Freezing profile (one pass)

Node RSS 292MB / 0.7% CPU / 35min uptime; **0 Chromium processes idle** (orphan sweep + idle timers healthy — R2-B working); SSE frames 1 per 320ms per active session only (no broadcast); API latencies all < 175ms (findings 156ms / missions 172ms / sessions 1.5ms / metrics 2.8ms / v2 8-12ms); evidence-graph 40MB / missions.json 29MB load in ~250ms. Backend is NOT the freeze bottleneck; frontend DOM scale (7,914-card Bugs page) and the closeOtherBrowsers interaction are the real costs. No production LLM latency measured in this pass (no mission run; LLM path unchanged since R2-B-H).

## Summary table

| # | Complaint | Verdict | Root cause (file:function) | Severity | Status |
|---|---|---|---|---|---|
| 1 | Cross-user run visibility | **CONFIRMED** | No owner identity anywhere; reads unscoped (store.js:createSession; index.js:878/1934/1920) | **P0** | Not fixed |
| 2 | Runs freeze | **CONFIRMED** | closeOtherBrowsers kills paused runs' browsers (agent.js:222/:553); 2,833 never-started mission shells; UI 7,914-card DOM | P1 | Not fixed |
| 3 | Unexpected INTERRUPTED | **CONFIRMED** | Boot sweep flips any in-flight run (store.js:66); no interruptedReason surfaced on sessions; specimen 396edfcf | P0 (UX) | Not fixed |
| 4 | Evidence opacity | **CONFIRMED** | No per-run evidence counters; findings carry no evidenceIds; screenshots not persisted as bytes (evidenceGraph.js:~1100) | P1 | Not fixed |
| 5 | Schedules unproven | **MECHANISM PROVEN** | Scheduler fires (11/11 today, 19:09 controlled fire) — **but every run fails: BrowserStack invalid creds + strict no-fallback (config.json)** | P0 (exec) | Not fixed |
| 6 | Meeting mic failures | **ENVIRONMENT** | No /dev/snd; no fake-audio launch flags in SDK config (agent.js:296-308) | P1 | Not fixed |
| 7 | Activity w/o browser panel | **CONFIRMED** | Frames tied to browser_open/hasPage only (agent.js:815/:546; index.html:220) | P1 | Not fixed |

**Action items (minimal fixes, ordered):** 1) BrowserStack credentials or disable BS (unblocks 11 daily schedules) · 2) ownerId + scoped reads (tenancy decision needed) · 3) closeOtherBrowsers: skip awaiting_input · 4) interruptedReason + pendingQuestion projections · 5) evidence counters at finalize · 6) meeting media flags · 7) browser-panel loading state.
