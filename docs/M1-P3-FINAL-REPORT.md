# M1-P3 — FINAL REPORT (Production Backend & Architecture Readiness)

**Status: PASS** — production gate green, 1,184 tests / 1,182 pass / 0 fail /
2 documented known-open-bugs (P1-4 duplicate test-case names; phase9.3 RL-1
byte-bound now enforced by the new byte-budget prune).

## What was inspected (Phase 0–2, zero code changes)

Startup/lifecycle, routing (119 index.js + 34 phaseRouter routes), mission &
session lifecycle, all 15 JSON stores, evidence/artifact persistence,
fix-validation persistence, scheduler/watchdogs, auth/token handling,
browser/device abstraction (local Chromium for missions; replay local OR
BrowserStack with strict-mode honesty), LLM boundaries, error handling,
config. Full detail in:
- docs/M1-P3-ARCHITECTURE-AUDIT.md
- docs/M1-P3-PRODUCTION-RISK-REGISTER.md (7 P0 / 5 P1 documented)
- docs/M1-P3-EXECUTION-LIFECYCLE.md

## What was changed and why (Phase 3 — smallest safe fixes only)

| Fix | File(s) | Why |
|---|---|---|
| P0-1 atomic evidence-graph save + loud corruption | server/evidenceGraph.js | copy-not-rename could truncate the 29MB store on crash; silent reset destroyed evidence on parse failure |
| P0-2 atomic fix-validation save + loud corruption + boot reaper for stuck QUEUED/RUNNING | server/fixValidation.js | 4MB plain write; 2 stuck validations (fxv_f80d, fxv_61b3) permanently blocked revalidation via the 409 active-check |
| P0-4 zombie-mission recovery on boot | server/missions.js, server/index.js | 57 missions stuck `running` forever (session pruned before lazy finalization) → reaped to `interrupted` |
| P0-5 S1 token-leak fix + public-read restoration | server/index.js, server/phaseRouter.js, public/shared.js, public/app.js | setAuthCookie handed the mutation token to anonymous page loads; removing it exposed that 8 UI read surfaces (projects, findings list, missions list, finding detail/evidence, mission-for-session, ux-quality, loop-status, evidence stats/coverage) only worked because of the leak — all restored as explicit public reads; mutations stay gated |
| P0-6 gate the last open mutation | server/index.js | PATCH /api/findings/:id/status was unauthenticated |
| P1-1/P1-2 true pagination totals | server/evidenceGraph.js, server/index.js | totals were a second unbounded query / computed after slicing |
| Phase 5 Option A byte-budget prune | server/store.js | count-only prune let 50 heavyweight sessions reach 31.9MB; now capped at 12MB payload (58→25 sessions, 31.9→14.9MB) |

## Test updates (strengthening, not weakening)

- tests-real/security/security-detection.test.js S1: flipped from "documents
  the open vulnerability" to "regression guard — token must NEVER be handed
  out again" (the test's own comment prescribed this flip when fixed).
- tests-real/phase17-api.test.js ux-quality anonymous expectation: 401→200
  with a comment documenting the restored public-read posture (the panel is a
  derived read; it only appeared gated because the S1 cookie masked it).

## Phase 7 — Regression & gate

- Targeted: browserstack-trust 1/1, execution-provenance 65/65, device-execution
  + device-context 36/36, phase18 unit/api/e2e 61/61, phase16-api + phase18-api
  30/30, security+contract+truthfulness 63/63, phase9.3 19/19.
- Full gate: `npm run test:gate` → **PASS**, 1,184 tests / 1,182 pass / 0 fail /
  2 known (both documented, neither new). Categories: core 1103/1104 (1 known),
  contract 31/31, truthfulness 18/18, e2e 30/31 (1 known).
- Report: artifacts/test-report.json + .html.

## Phase 8 — Final verification

Server clean start, /api/health 200, token auth verified (mutations 401
anonymous / 200 with Bearer), S1 regression guard green, missions/execution/
evidence/findings/fix-validation flows exercised via suites above,
BrowserStack truthfulness suite green, protected suites all green, no secrets
introduced (gitconfig corruption workaround unchanged).

## P0/P1/P2 summary

FIXED this phase: P0-1, P0-2, P0-4, P0-5, P0-6, P1-1, P1-2 (+ Phase 5 Option A).
DOCUMENTED, NOT FIXED (too large for this phase): SSRF targetUrl validation,
no mission concurrency cap, missions.json bloat (per-iteration findings
duplication), SIGTERM debounce flush, store path unification, silent-empty
loads in remaining stores, webhook bus event mismatch, browserstackUser
cleartext in config GET, createMission caller-supplied id, error-shape
unification, artifacts auth, rate limiting, artifact pruning (217MB).

## Production-readiness score

Backend architecture: **7/10** (was 5/10 at phase start — data-loss classes
closed, auth leak closed, zombie states recoverable; multi-tenancy and SSRF
remain the top gaps).

## Recommended M1-P4 scope (not started)

1. SSRF per-project URL allowlist + scheme/private-IP validation.
2. Mission concurrency cap + queue (protects 6GB box at 10+ missions).
3. missions.json slimming (store iteration deltas, not full findings arrays).
4. Store path unification + loud-fail loads everywhere + SIGTERM flush.
5. browserstackUser redaction + server-side mission id generation + unified
   error shape.

**Stopped here per instructions — M1-P4 not started.**
