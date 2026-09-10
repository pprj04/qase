# P0 Reliability & Execution Trust Fix Pack — task spec

Forensic findings (ticket #8989, note `forensics-prod-complaints-2026-09-03.md`) are the
starting point. No re-investigation. Smallest production-safe changes; no architecture
redesign; strict provider mode stays; no weakening of auth.

## Verified baseline (before any edit)

- Replay path (test-case/replay.js) **already** implements truthful BrowserStack
  failure: `resolveLaunchPlan` (browserstackCaps.js) selects BrowserStack only when
  `browserstackEnabled && user && key`; missing key → plan.mode='local' silently.
  Strict errors throw `BrowserStackStrictError` (no local fallback) and stamp
  `executionEnvironment {provider:'browserstack', failed:true}` on the run.
- Agent path (C4) **already** implements deterministic provider failure for explicit
  requests: `resolveAgentExecutionPlan` + `attachBrowserstackRuntime`
  (BrowserStackMissionError), no fallback ever. Provenance recorded
  (provider/browser/version/os/device/executedOn; null = unknown).
- Existing suites green: c4-agent-browserstack (24), c4-1-probe-verdict (9),
  browserstack-trust 50/51 (the 1 fail is an AUTH-mode issue, not provider).
- **Pre-existing failures (NOT caused by this pack, verified on baseline):**
  - `execution-provenance.test.js` [5]/[8]: runs record provider `browserstack`
    although the live config has `browserstackEnabled:true, user set, key MISSING`.
    Root cause: `resolveLaunchPlan` treats "user set + no key" as browserstack-mode
    selected (caps carry empty accessKey → CDP 401) and replay stamps provider
    `browserstack`. The suite expects provider `local` — an execution-truth bug this
    pack fixes (incomplete config ⇒ truthful provider error, never a phantom
    browserstack claim).
  - `d23-browserstack-probe-auth.test.js` 8/8 SKIP: live server runs
    QASE_AUTH_MODE=disabled → suite self-skips (by design).
- Live config state: `browserstackEnabled:true, strict:true, user set, key missing,
  lastVerified {ok:false, code:'invalid_credentials'}` → every scheduled replay run
  fails at launch with the strict BrowserStack error. Truthful, visible in run rows
  (errored:1). Scheduler untouched.

## Fixes

### F1 — BrowserStack config validation before execution (replay path)
- `browserstackCaps.resolveLaunchPlan`: BrowserStack selected requires BOTH user AND
  key. Incomplete (enabled + user, no key / key without user) returns
  `{mode:'error', code:'invalid_credentials', error, strict:true}` — a deterministic
  config-validation failure BEFORE any launch attempt, same for agent plan.
- `replay.launchBrowser`: `plan.mode==='error'` (invalid creds) throws
  `BrowserStackInvalidConfigError` (subclass shape of BrowserStackStrictError);
  run error records `browserstack_invalid_config: <redacted message>`;
  executionEnvironment stamped `provider:'browserstack', failed:true`, never local,
  never a silent local run.
- Existing behavior preserved: complete+valid-shaped creds → BrowserStack attempt;
  connect failure → strict error (no fallback) or loud legacy fallback when
  `browserstackStrict === false` (unchanged escape hatch).
- Provenance: unchanged builders (`buildExecutionEnvironment`); failure reason
  exposed on the run (`result.error` + failed environment); secrets redacted via
  `redactSecrets` (caps/URL never logged).

### F2 — closeOtherBrowsers ownership
- `agent.closeOtherBrowsers(keepId)` may only close browsers of sessions in a
  TERMINAL or dead state (completed/failed/aborted/cancelled/timeout/interrupted/
  error/idle with no pending question). Sessions `running`, `awaiting_input`, or
  paused-with-live-need keep their browser. Governor/concurrency untouched.

### F3 — Interrupted reason truth
- store.js `loadSessions` boot sweep: running/awaiting_input → interrupted keeps
  `interruptedReason:'server_restart'`, preserves `pendingQuestion` (only cleared
  by expiry path), clears stale `awaitingInputSince`.
- runWatchdog writers stamp `interruptedReason` ('watchdog_stuck',
  'watchdog_max_duration', 'awaiting_input_timeout'). Historical records with
  unknown cause stay reason-null (never fabricated).
- v1 session projection (`GET /api/sessions/:id`) exposes `interruptedReason`,
  `pendingQuestion` when interrupted-with-preserved-question, `awaitingInputSince`.

### F4 — Ownership scoping (server-side)
- `createSession`/`createMission` stamp `ownerId` from `request.auth`
  (userId for user sessions; master/open keep current shared-workspace semantics —
  documented single-workspace posture).
- Reads: `listSessions`/`listMissions`/`listFindings` scoped by ownerId for user
  principals; detail/SSE/mutation endpoints reject non-owned resources 404 (no
  existence leak). Master/admin(role) see all (documented).
- Findings/evidence inherit scoping via mission/session ownership.
- Tests boot child servers in REQUIRED auth mode with two real user accounts.

### F5 — Frame recovery on resume
- `runTurn` resume: if bridge has no page (browser gone), recreate via the runtime's
  browser service (`ensurePage` restores storage + navigates back via saved URL),
  restart frame streaming, emit truthful `browser reconnecting` state. Never fake
  frames; provider failure surfaces through F1 path.

## Tests (tests-real/p0-reliability-fixpack.test.js)
A valid-config BrowserStack plan/session path (stubbed CDP) · B invalid creds →
truthful provider failure on run+mission · C no silent local fallback · D explicit
local still works · E awaiting_input browser survives other mission turn · F resume
after pause works · G interrupted reason stored+exposed · H pendingQuestion preserved
· I/J/K isolation for missions/sessions/findings (required-auth child servers) · L SSE
cross-user blocked · M paused+closed browser recovers frames on resume · N lifecycle
cleanup regression (R1/R2 suites re-run).

## Acceptance
- [ ] Scheduled/standalone replay with enabled-but-invalid BrowserStack fails
      truthfully as provider failure, no local run, provenance browserstack/failed
- [ ] execution-provenance suite failures fixed (provider truthful again)
- [ ] awaiting_input browser survives `closeOtherBrowsers`
- [ ] interrupted sessions carry truthful reason + pending question via API
- [ ] cross-user access blocked server-side on list/detail/SSE/mutation
- [ ] resume with missing browser reconnects + restarts frames
- [ ] R1/R2 suites green
