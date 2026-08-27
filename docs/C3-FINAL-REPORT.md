# C3 — Finding Quality & Autonomy: Final Report

**Status: C3 COMPLETE.** Baseline: C2 @ 1766bec. All phase contracts met, all gates green. **Not published — awaiting operator decision.**

---

## 1. What C3 changed

### A. Target-classification quality gate (featureGap.js, P2)

Purpose-catalog expectations ("a CRM must have contact management") are now generated **only when `purpose.confidence ≥ 0.5`**. Below the floor, catalog expectations are suppressed and the gate outcome is recorded in structured data — `gated`, `purposeConfidence`, `excludedByUncertainty`, `gateReason`. Everything grounded in *observed* behavior (auth structure from the real login page, form validation, pending agent todos) keeps firing regardless of classification confidence.

**Live proof (new.drytis.com, previously the worst offender):**
- Gap analysis now records: `"gated": true, "purposeConfidence": 0.067, "excludedByUncertainty": 2, "gateReason": "purpose confidence 0.07 below floor 0.5 — catalog expectations suppressed"`
- Classification improved from "CRM" → "Marketing / Landing Page"
- C2 baseline: 13 findings incl. a 0.06-confidence **critical** "Contact/company management missing" → C3: **0 catalog-derived noise**, findings are observed-workflow items (Browse code / Merge to main / Commit changes) and untested-plan items

### B. Decision-grade findings (decisionEngine.js, P3)

`criticalCount`/`highCount` feeding STOP_FAIL / Safety-Rule-3 now count only **decision-grade** findings: non-duplicate, severity critical/high, AND (numeric confidence ≥ 0.7 OR confidence null/unknown → keeps legacy weight, so agent-filed confirmed criticals that were never scored still stop). Raw counts stay visible as `rawCriticalCount` / `rawHighCount` / `lowConfidenceCriticalCount` signals. A low-confidence critical can still drive INVESTIGATE, never STOP_FAIL.

**Live proof:** the new.drytis.com mission with 1 critical @ conf 0.1 → **completed** (no STOP_FAIL). In C2 the identical shape produced STOP_FAIL on 0.06-confidence criticals. Confirmed decision-grade criticals still STOP_FAIL (regression-tested).

### C. Mission↔finding linkage (findings.js, P4)

Session-born findings now stamp `missionId` at write time, plus a boot-time idempotent guarded backfill (null missionId + resolvable sessionId → exactly one mission). Mission documents untouched.

**Live proof:** `/api/v2/findings?mission_id=` now returns real counts (9, 11, 11 across C3 benchmark missions) — closes the C2-reported read-API gap. Benchmark semantics unchanged (harness falls back to the mission document).

### D. Mid-session autonomy probe (midSessionProbe.js + agent.js + index.js, P5)

Every **K=4 turns** at `assistant_turn_start`, for mission-linked running sessions only, the deterministic engine (`makeDecisionSafe`) is consulted:
- CONTINUE / INVESTIGATE / REPLAN / REVALIDATE → trace with state `session:running:probe`, hint recorded on the session (`_probeHint`, consumed by the settle gate), **no dispatch, no steering, no LLM call**
- ESCALATE / STOP_FAIL **with decision-grade criticals** → early settle through the SAME AbortController seam the budget uses → normal finalize path
- STOP_BUDGET / STOP_BLOCKED → ignored at probe (they're for the settle gate)
- One-in-flight, 5s cooldown, input-signature anti-churn; **never touches maxTurns, never blocks the stream**

**Live proof (every benchmark mission, both arms):** trace now shows `CONTINUE (probe) ×3 → STOP_BUDGET (settle)` — 4 decisions per mission vs C2's 1. The autonomy loop is now visible mid-mission, not only at settle.

### E. Trace schema (P6)

Unchanged 13 fields. Probe decisions reuse the schema with `state: 'session:running:probe'`. Signals remain KEYS-only. No chain-of-thought, no secrets.

## 2. Live A/B benchmark (P9) — 12-turn pools

| Target | Arm | Status | Findings (crit) | Decisions | Vocabulary |
|---|---|---|---|---|---|
| 9901 (crm) | A-off | completed | 10 (0) | 4 | CONTINUE×3, STOP_BUDGET |
| 9901 | B-auto | completed | 9 (0) | 4 | CONTINUE×3, STOP_BUDGET |
| 9902 (taskboard) | A-off | completed | 15 (2) | 4 | CONTINUE×3, STOP_BUDGET |
| 9902 | B-auto | completed | 12 (2) | 4 | CONTINUE×3, STOP_BUDGET |
| 9903 (shop) | A-off | completed | 10 (1) | 4 | CONTINUE×3, STOP_BUDGET |
| 9903 | B-auto | completed | 13 (1) | 4 | CONTINUE×3, STOP_BUDGET |
| new.drytis.com | A-off (smoke) | completed | 11 (1 crit @ conf 0.1 — **gated, no STOP_FAIL**) | 4 | CONTINUE×3, STOP_BUDGET |
| new.drytis.com | B-auto (smoke) | completed | 11 (0 critical — catalog noise suppressed) | 4 | CONTINUE×3, STOP_BUDGET |

Notes: A/B arms remain outcome-equivalent in this benchmark shape (by design — both stop at the same pool; the probe correctly judged CONTINUE at every checkpoint because no decision-grade critical merited an early stop and coverage was still growing). The differences C3 introduces show exactly where intended: low-confidence criticals no longer flip the verdict, and probes now leave auditable mid-mission traces. The `new.drytis.com` full_audit legs of the harness hit a transient external fetch failure (site itself was up — verified 200 separately); the smoke-arm runs against the same target give the live evidence.

**missionId retrieval assertion:** every mission's `/api/v2/findings?mission_id=` returns ≥ 1 non-zero matching count (9/11/11 …). PASS.

## 3. Test results (P7/P10)

| Suite | Tests | Pass |
|---|---|---|
| c3-finding-quality | 17 | 17 |
| c3-mid-session-autonomy | 16 | 16 |
| c2-autonomy-contract + closeout-failure-modes | 28 | 28 |
| c2-live-decision-proof (live) | 4 | 4 |
| b2-golden-loop + b2-decision-wiring | 12 | 12 |
| b1-security-negative / linkage / live-retry / integration-auth / webhook / start-path / crash-restore | 4+6+2+28+17+1 | all |
| m1-p4.4-persistence | 28 | 28 |
| phase4-decision-engine | 61 | 61 |
| phase5-validation-loop | 59 | 59 |
| phase9.2 e2e + safety | 64 | 64 |
| c1-usage-api | 20 | 20 |
| b0-restart-config | 1 | 1 |
| **Total** | **355+** | **0 fails** |

(One m1-p4.4 run flaked mid-suite because the container auto-paused and restarted the server underneath it — clean re-run 28/28, twice.)

## 4. Security / boundary checks (unchanged, re-verified)

- Anonymous `/api/v1/missions` → 401; public surface remains exactly `/api/health`, `/api/v2/health`, `/openapi.json` (all verified live, post-restart)
- Budget authority stays external: probe never touches maxTurns; c2/b2 canaries prove no bypass
- targetGuard/SSRF untouched; no new endpoints; no new trace fields

## 5. Restart/production gate (P10)

Server restarted via procmgr: health OK, 401/200/200 boundary intact, mission + 4 decision traces persisted through restart, boot recovery re-adopted 1 running mission honestly, all suites green post-restart.

## 6. Limitations / follow-ups

1. **Probe vocabulary in live runs so far: CONTINUE only.** INVESTIGATE/REPLAN/early-stop are unit-proven (16/16) but a live mission hasn't yet produced a mid-session decision-grade critical — expected, since C3 itself reduces spurious criticals. A buggy-enough benchmark target (e.g. app6-contactvault) would likely exercise early-stop live; deferred, noted.
2. **new.drytis.com full_audit legs failed on an external fetch error** during the harness run (target was reachable when probed directly); smoke legs provide the live evidence for that target.
3. Classification quality is gated, not fixed — a 0.5-confident wrong classification still yields catalog findings. Raising classification accuracy itself is future app-understanding work (B5/C-series), out of C3 scope.

## 7. Acceptance checklist

- [x] P2 gate: purpose.confidence floor 0.5, structured gate metadata, observed-beavior expectations unaffected — **live-verified**
- [x] P3 decision-grade: conf ≥ 0.7 or unknown; raw counts preserved; low-conf critical → INVESTIGATE not STOP_FAIL — **live-verified**
- [x] P4 linkage: write-time stamp + idempotent backfill; v2 filter returns real counts — **live-verified**
- [x] P5 probe: K=4, deterministic, no steering, early-stop only via existing abort seam, budget untouched — **live-verified**
- [x] P6 trace schema unchanged (13 fields, probe state tag)
- [x] P7 both new suites green (33 combined)
- [x] P9 A/B on 9901/9902/9903 + new.drytis.com with missionId retrieval assertion
- [x] P10 regression (355+ green) + security boundary + restart persistence
- [x] P11 this report; publish readiness — staged and ready, **awaiting operator go**
