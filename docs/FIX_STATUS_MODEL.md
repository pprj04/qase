# Fix Status Model — Phase 18

Deterministic status model for autonomous fix validation. An LLM never selects
the final status — it is **derived** from validation evidence by
`server/fixStatusEngine.js` (pure functions, no I/O).

## 1. Fix validation lifecycle (run-level)

```
            ┌──────────┐   executor picks up    ┌──────────┐
 REQUESTED →│ QUEUED   │ ─────────────────────► │ RUNNING  │
            └──────────┘                        └────┬─────┘
                                                     │
                        ┌────────────────────────────┼─────────────────────────┐
                        ▼                            ▼                         ▼
                  ┌───────────┐              ┌────────────┐            ┌────────────┐
                  │ COMPLETED │              │   FAILED   │            │ CANCELLED  │
                  └───────────┘              └────────────┘            └────────────┘
```

- `REQUESTED` — API accepted the request (idempotency key recorded).
- `QUEUED` — persisted; awaiting the executor loop.
- `RUNNING` — attempts + regression scan in flight.
- `COMPLETED` — a fix status was derived deterministically.
- `FAILED` — infrastructure error (executor never rejects into a fake status).
- `CANCELLED` — explicit cancel while not RUNNING.

## 2. Finding-level fix status (outcome of a COMPLETED run)

| Status | Meaning | Derived when |
|---|---|---|
| `VERIFIED_FIXED` | failure gone + expected observed + sufficient evidence | not reproduced ≥ required attempts, expected reached, evidence sufficient, no verified regression |
| `STILL_BROKEN` | original failure reproduced | reproduction evidence captured in ≥1 attempt |
| `PARTIALLY_FIXED` | some conditions fixed, related remain | failure not reproduced **and** verified partial-fix signals (e.g. primary fixed, related failure remains) |
| `REGRESSED` | fixed but a verified regression exists / previously-working workflow broken | not reproduced + ≥1 verified regression (checked **before** VERIFIED_FIXED) |
| `UNABLE_TO_VERIFY` | evidence insufficient / intermittent / environment mismatch | any of the inconclusive gates fire |
| `REOPENED` | human reopened after closure | review action only |

Decision order in `classifyFixStatus` (first match wins — later checks can
never "rescue" an earlier decisive observation):

1. **environment mismatch** (deterministic compare of URL/viewport/browser/
   device/OS/data/credentials deltas) → `UNABLE_TO_VERIFY`
2. **original failure reproduced** → `STILL_BROKEN` (even if expected state
   also reached — reproduction is decisive)
3. **inconclusive attempts** (no decisive observation either way) → `UNABLE_TO_VERIFY`
4. **expected not observed** and not reproduced → `STILL_BROKEN`
5. **mixed attempts** (some pass, some fail) → `UNABLE_TO_VERIFY` (intermittent ≠ fixed)
6. **insufficient evidence** for category → `UNABLE_TO_VERIFY`
7. **verified regression(s)** → `REGRESSED` (never VERIFIED_FIXED when a
   verified regression exists — spec §12)
8. default → `VERIFIED_FIXED`

## 3. Review states (human-in-the-loop)

```
 AUTO_VALIDATED ──► REVIEW_REQUIRED ──► APPROVED ──► (lifecycle closure)
                        │                              │
                        ▼                              ▼
                     REJECTED                      REOPENED ◄── (any closed state)
```

`review = { state, reviewer, decidedAt, comment, trail[] }`. Approval applies
to **final lifecycle closure only** — approving a validation transitions the
*finding* to `RESOLVED` via the existing Phase 16 lifecycle; it does not
rewrite evidence. Transitions are validated by `VALIDATION_REVIEW_TRANSITIONS`.

## 4. Attempt aggregation

- `attempts` — configured attempts (default 2, `QASE_FIX_VALIDATION_ATTEMPTS`).
- `successfulAttempts` / `failedAttempts` — per-attempt replay outcomes.
- `reproductionRate = failedAttempts / attempts` (fraction reproducing the
  original failure). 3/3 pass → VERIFIED_FIXED candidate; mixed pass/fail →
  UNABLE_TO_VERIFY (intermittent ≠ fixed).

## 5. Validation confidence (NEW measurement — never the finding's confidence)

Weighted evidence signals (`computeValidationConfidence`), output 0–1:

| Signal | Weight | Notes |
|---|---|---|
| sameReproPath | 0.15 | validation executed the finding's own steps |
| sameEnvironment | 0.10 | URL/viewport/browser/device/OS/data/credentials deltas empty |
| expectedReached | 0.20 | expected state observed |
| originalAbsent | 0.20 | original failure not reproduced |
| attemptsStable | 0.15 | all attempts agree (tri-state: undefined = no penalty) |
| consoleClean | 0.05 | no console errors during validation |
| networkSuccessful | 0.05 | no failed requests |
| relatedWorkflowPasses | 0.05 | targeted regression set green |
| evidenceComplete | 0.05 | evidence sufficiency met |

Base 0.1 when only `expectedReached` is known. Confidence 0 unless
`expectedReached` or `originalAbsent` (a decisive observation) exists.
Never copied from the finding's Phase 16 `confidence`.

## 6. Knowledge safety gate

`isTrustworthyForKnowledge(status, confidence)`:

| Outcome | Stored? | As |
|---|---|---|
| `VERIFIED_FIXED`, confidence ≥ 0.7 | ✅ | fix-validation knowledge |
| `STILL_BROKEN`, confidence ≥ 0.7 | ✅ | failure knowledge |
| `UNABLE_TO_VERIFY` / `PARTIALLY_FIXED` / `REGRESSED` / low confidence | ❌ | never a confirmed fact |

Written through the **existing** `knowledge.js` store via
`writeFixValidationKnowledge` — no second memory system (spec §16–17).

## 7. Idempotency

`POST /api/v1/findings/:id/revalidate` accepts an `Idempotency-Key` header.
Duplicate keys return the **existing** run (`idempotent: true`, 202) — no
duplicate browser runs. Without a key, a new run is created unless one is
already active for the finding (409).
