# Phase 18 Spec — Autonomous Fix Validation

Objective: close the loop FINDING → ORIGINAL EVIDENCE → REPRODUCTION → CHANGE →
REVALIDATION → BEFORE/AFTER COMPARISON → FIX STATUS → REGRESSION CHECK →
KNOWLEDGE UPDATE → HUMAN REVIEW. Qase does NOT modify applications; it validates
whether a change fixed a previously identified problem.

Phase 17 is FROZEN — no changes to phase17 modules except additive wiring. Phase 19
must not be started. Stop after the Phase 18 report.

## Invariants (must all hold)

1. The original finding is IMMUTABLE historical evidence. Validation results are
   stored separately (`.qase/fix-validations.json`), never merged into the finding
   record except additive pointer fields (`fixStatus`, `validationCount`,
   `lastValidationId`) — title/category/severity/priority/confidence/expected/
   actual/steps/evidence/timestamps of the finding are never overwritten by
   validation.
2. Final fix status is DERIVED deterministically from validation evidence
   (`fixStatusEngine.classifyFixStatus`). No LLM call may select the final status.
3. One non-reproduction is NEVER sufficient for VERIFIED_FIXED. Evidence
   sufficiency thresholds must pass (§9 of the mandate), and multi-attempt
   aggregation with a reproductionRate guard applies.
4. REGRESSED beats VERIFIED_FIXED: any verified regression in the targeted
   regression set downgrades the final status.
5. Validation runs are async with stable IDs (`fxv_*`) and idempotent on
   `Idempotency-Key` (duplicate submissions return the existing run, no duplicate
   execution).
6. Auth inherited: v1 routes use `requireIntegrationAuth` + `authorizeFinding`
   (workspace/project scoping intact); dashboard routes use cookie token. The
   pre-existing unauthenticated `PATCH /api/findings/:id/status` gets the same
   token auth as its siblings (open only when no token is configured — current
   deployment behavior unchanged, hardened in principle).
7. Evidence redaction: all validation evidence passes through the existing
   `redactString`/`redactEvidenceItem`; credentials/tokens/cookies never persist.
8. Knowledge updates ONLY for trustworthy outcomes: VERIFIED_FIXED /
   STILL_BROKEN with validationConfidence ≥ 0.7. UNABLE_TO_VERIFY and
   PARTIALLY_FIXED never become confirmed knowledge.
9. Human review trail: AUTO_VALIDATED → (APPROVED | REJECTED | REOPENED) recorded
   with reviewer, timestamp, decision, comment. Human approval applies to final
   lifecycle closure (finding → RESOLVED), not to internal validation steps.
10. Same-condition validation: original URL/viewport/device/workflow reused where
    recorded; any deviation recorded in `environmentDeltas[]`.

## Fix status model

`VERIFIED_FIXED | STILL_BROKEN | PARTIALLY_FIXED | REGRESSED | UNABLE_TO_VERIFY`
(+ lifecycle side-states REOPENED on the finding). Validation run statuses:
`REQUESTED → QUEUED → RUNNING → COMPLETED | FAILED | CANCELLED`.

## New modules

- `server/fixStatusEngine.js` — pure: classification, confidence, partial-fix
  detection, regression classification, evidence sufficiency, attempt aggregation.
- `server/fixValidation.js` — store (`.qase/fix-validations.json`), lifecycle,
  plan persistence, review transitions, knowledge-update gating, metrics.
- `server/validationExecutor.js` — builds plan from finding (original steps →
  replay bridge via test-case shape), executes via `replay.runTestCase` (same
  viewport/device as original where recorded), captures before/after evidence
  (screenshots → evidence graph SCREENSHOT nodes linked to the finding), runs
  risk-based regression selection (test cases linked via findingIds, same
  workflow/feature findings' cases), aggregates attempts, writes result.

## New APIs (v1, integration auth)

- `POST /api/v1/findings/:id/validate-fix` → 202 `{validationId, statusUrl}` (idempotent)
- `GET  /api/v1/findings/:id/validation` → history + latest (404 until one exists)
- `GET  /api/v1/findings/:id/comparison` → structured before/after (404 until completed)
- `POST /api/v1/findings/:id/approve` → review APPROVED + lifecycle closure gate
- `POST /api/v1/findings/:id/reopen` → review REOPENED + finding REOPENED
- Dashboard (cookie): `GET /api/findings/:id/fix-validation` (panel payload)

Existing endpoints unchanged. Drytis webhook contract unchanged (a new optional
`finding.fix_validated` event MAY be emitted; existing payloads untouched).

## UI (bugs.js bug-detail modal, additive)

FIX VALIDATION section: status badge + validationConfidence (separate from finding
confidence), attempts summary (N/M successful, reproductionRate), original vs
validation evidence lines, regression verdict, actions [Validate Fix] [View
Original] [View Validation] [Compare] [Approve Closure] [Reopen]. Board filter by
fix status. Before/After comparison view uses real evidence pairs.

## Benchmark (deterministic, no LLM)

`scripts/fix-validation-benchmark.mjs` — 10 scenarios: fully fixed, still broken,
partial fix, fixed+regression, intermittent, environment mismatch, insufficient
evidence, UX fixed, API fixed, mobile fixed. Targets: fix-verification accuracy
≥90%, false-fixed rate ≤5%, regression detection ≥90%, evidence completeness ≥95%.
No PASS claim if any target missed.

## Tests

- Unit: fixStatusEngine (classification, confidence, partial detection, regression
  classification, evidence sufficiency, attempt aggregation), store lifecycle,
  knowledge gating.
- Integration (`phase18-api.test.js`): create validation → retrieve → complete →
  compare → status update → regression recorded → approve → reopen (+ idempotency,
  auth gates).
- E2E (`phase18-e2e.test.js`): 10 named cases — seeded bug discovered → fix
  simulated (benchmark fixed-variant app) → revalidated → verified → regression
  introduced → detected → finding REGRESSED → evidence survives refresh → history
  persists.

## Acceptance criteria

The 32 checkboxes in the Phase 18 mandate §30, plus: full regression green with no
new failures vs the Phase 17 baseline; `docs/PHASE_18_CURRENT_STATE.md`,
`docs/AUTONOMOUS_FIX_VALIDATION.md`, `docs/FIX_STATUS_MODEL.md`,
`docs/VALIDATION_EVIDENCE_MODEL.md`, `docs/PHASE_18_REPORT.md` (27 sections)
delivered; stop rule honored.
