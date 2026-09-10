# Phase R1 — Lifecycle correctness fixes (P0)

## G1: Integration stop on queued mission (stuck-forever + surprise execution)
`POST /api/v1/integration/missions/:id/stop` (index.js:2207-2221) unconditionally writes `aborted`. For a `queued` mission `queued→aborted` is illegal (stateTransitions.js:30) → status silently dropped (missions.js:263-266) → queue entry freed but mission stays `queued` forever in-process; boot `requeuePersistedMissions` (index.js:4552) then RE-EXECUTES a mission the user stopped. Also reports `aborted` for `created` missions (illegal).
**Fix** (mirror the v1 route index.js:3086-3122): queued → `governorCancelMission` → `cancelled`; created → `cancelled` via legal `created→cancelled`; terminal → idempotent no-op; running → existing abort path.

## G5: Governor timeout loses evidence
`onTimeout` (index.js:4748-4763) writes `failed` WITHOUT `finalizeTurnLimitedRun` and WITHOUT `collectEvidenceForSession` (D1 added these to error/interrupted paths at :4142 only). Timed-out missions get no deterministic report and zero evidence nodes.
**Fix**: onTimeout calls the same close-out pair (finalizeTurnLimitedRun → collectEvidenceForSession → finalizeMission failed/`execution_timeout`).

## G7: ensureRuntime-hang double-finalize race
If `ensureRuntime` hangs, session sits `idle`; governor stuck detector (:206-222) treats idle as settled ≥90s → finalizes mission `completed/inconclusive` while the runtime kick is still pending; when it later resolves, `completed→running` is legal → mission re-opens mid-flight.
**Fix**: guard — onStuck must not finalize when a runtime kick is pending for the session (expose a `pendingRuntimeKick` flag on the live record set in ensureRuntime before await, cleared after startTurn begins); and the late-resolution path must refuse to re-open a finalized mission (check terminal before entering runTurn).

## G12: Honesty-guard reads wrong field
index.js:4137 reads `session.transcript`; store uses `messages` (store.js:257-262) → `firstErr` always undefined → generic failure reasons. **Fix**: read `messages`.

**Files**: server/index.js, server/missionGovernor.js, server/agent.js. Zero changes to healthy paths.
**Acceptance**: queued integration stop → `cancelled`, never re-executed after simulated boot; timed-out mission has report + evidence nodes; hung-kick mission can't be double-finalized/re-opened; failure reasons carry first error text.
