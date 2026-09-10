# Phase R3 — Persistence & observability hardening (P1)

## G4: Dead webhook listener (missed notifications)
`missionBus.on('updated', …)` (index.js:4781) but the store emits `mission:updated` (missions.js:269) → `mission.failed` webhooks never fire for updateMission-based failures (runtime-start failure :2976/:2105, start catch :2979, queue-start :4625). Same class as P4.3's R5.
**Fix**: align the event name (one side), keep `mission:finalized` listener as-is.

## G9 (partial, loud-not-silent): corrupt-load + write-failure visibility
Corrupt store → silently starts EMPTY (store.js:77-89, missions.js:56-76) — deliberate forensics but invisible. Write failures swallowed (store.js:36-38).
**Fix (visibility only, no policy change)**: (a) each store records `lastCorruptLoadAt`/`corruptBackupPath` when quarantining; exposed via `GET /api/v1/diagnostics/state-integrity` + a `console.error` at boot; (b) per-store write-failure counter incremented in the debounced-write catch, exposed in the same diagnostics payload. No auto-restore, no auto-backup (documented tradeoffs stand).

## G14 (diagnostics only): boot integrity log
`stateIntegrity.js` exists but never runs at boot. **Fix**: run it once at boot after load; log findings; expose in diagnostics. NO auto-repair.

**Files**: server/index.js, server/missions.js, server/store.js (counters), server/stateIntegrity.js (reuse).
**Acceptance**: mission-failure webhook fires (listener name fixed); a quarantined store shows in diagnostics with timestamp + backup path; write-failure counters visible; boot logs an integrity summary line. No behavior change to healthy stores.
