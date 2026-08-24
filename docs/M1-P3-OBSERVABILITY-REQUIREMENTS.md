# M1-P3 — OBSERVABILITY REQUIREMENTS (Phase 6 deliverable)

No monitoring system built in this phase. This document answers, per question:
**can the backend answer it TODAY, and what is the minimum telemetry required?**

## Question-by-question

| # | Question | Answerable today? | Where |
|---|---|---|---|
| 1 | Is a mission running? | YES | `mission.status` in missions.json; `GET /api/v1/missions/:id`; sessions watchdog |
| 2 | What stage is it in? | YES | `session.phase` (explore/iterate/finalize), messages stream, `mission.iterations[].stage` |
| 3 | Why did it fail? | PARTIAL | agent error → session status failed + last error string; no structured error taxonomy (`error.code`) |
| 4 | What evidence was produced? | YES | evidence-graph nodes per step/session/mission; `GET /api/v1/missions/:id/evidence` (now with true totals) |
| 5 | What provider/device was actually used? | YES | provenance fields on runs (`provider`, `device`, `executionMode` REAL_DEVICE/EMULATED_DEVICE); execution-provenance suite (65 tests) enforces |
| 6 | Was the result deterministic or AI-derived? | PARTIAL | deterministic overrides leave markers (severity correction, fix-status derivation); LLM verdicts stored verbatim; no per-field `provenance` stamp on every finding field |
| 7 | How long did execution take? | YES | timestamps at every stage boundary; `durationMs` on sessions/runs |
| 8 | Was it retried? | PARTIAL | retry counters exist on browser actions; mission-level retry only via revalidate (`validationCount`); no mission-level retry counter |
| 9 | Was the final verdict supported by evidence? | YES | `calculateMissionQuality` derives verdict deterministically from findings/evidence; honesty guard blocks PASS on interrupted/failed sessions |

## Minimum telemetry required for production (M1-P5 scope, not built now)

1. **Structured error codes** — every failure path emits `{code, stage, message}`; taxonomy: `LLM_TIMEOUT`, `BROWSER_LAUNCH_FAILED`, `TARGET_UNREACHABLE`, `STORE_PERSIST_FAILED`, `MISSION_INTERRUPTED`, `SSRF_BLOCKED`.
2. **Stage transition events** — append-only event log (file or table) per mission: `stage_changed`, `provider_selected`, `evidence_captured`, `verdict_finalized` with timestamps + source (deterministic vs LLM).
3. **Store persistence health** — last-persist timestamp, bytes, write duration, failure counter per store.
4. **Mission lifecycle metrics** — started/completed/failed/interrupted counters; wall-clock duration histogram; LLM token/call counts (budget enforcement is M1-P5).
5. **Watchdog events** — turn-timeout, llm-idle, sweep counts already logged ad-hoc; promote to structured events.
6. **Request-level access log** — route, status, latency, auth'd? (feeds M1-P5 rate limiting).

## Existing signals NOT to break

- /api/health shape (uptime, version) — contract-frozen.
- Watchdog log lines (20-min turn timeout, 5-min LLM idle ×2, sweep cadence) — protected suites read them.
- execution-provenance markers — 65-test protected suite.
