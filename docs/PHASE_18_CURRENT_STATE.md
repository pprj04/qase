# Phase 18 Current State — Autonomous Fix Validation Audit

Audit date: 2026-08-17. Performed before any Phase 18 code (researcher, read-only).
Purpose: inventory what exists so Phase 18 implements only genuine gaps.

---

## 1. Existing revalidation functionality

- **Mission-level**: `POST /api/v1/missions/:id/revalidate` (index.js:2437) re-runs
  a FULL LLM exploration mission as iteration N+1. Guards: running → 409 (the only
  idempotency), iteration limit, no-improvement stop. Async 202 + poll. Auto-chain
  at finalize on REVALIDATE decision (index.js:3712). `validationLoop.js` owns
  iteration metadata, convergence (`analyzeConvergence`), prompts, knowledge
  injection.
- **Finding-level (enrichment only)**: `POST /api/findings/:id/revalidate`
  (index.js:1649) re-derives classification/severity/confidence from EXISTING
  evidence — no browser, no re-execution. Increments reproduction counters.
- **Workflow-level classification**: `workflowEngine.classifyRevalidation` →
  BLOCKED/CONFIRMED/INTERMITTENT/NOT_REPRODUCED — never applied to findings, and
  lacks PARTIALLY_FIXED / VERIFIED_FIXED / UNABLE_TO_VERIFY / REGRESSED.
- **Deterministic replay**: `replay.runTestCase/runTestSuite` — real Playwright,
  failure screenshots, console/network collectors, visual baselines, self-heal,
  retries + flaky detection. Runs TEST CASES only; there is no finding→replay or
  workflow→replay bridge (workflows must pass LLM test-gen first). Saved workflow
  steps `{action,target,value,url}` map ~1:1 onto the replay step shape.

## 2. Existing finding lifecycle

Phase 16 (findingIntelligence.js): LIFECYCLE incl. RESOLVED/REOPENED +
`LIFECYCLE_TRANSITIONS` table + `validateLifecycleTransition` +
`transitionFindingStatus` (audited history[], live VERIFIED evidence gate) +
`setReviewStatus` (unreviewed/confirmed/false_positive/duplicate/needs_info).
1,551 findings live in `.qase/findings.json`.

## 3. Existing evidence relationships

evidenceGraph.js: 12 EVIDENCE_TYPES (screenshot/network/console/dom/api_response
enums RESERVED but only step_outcome/finding_detail/console populated — 33.5k
nodes, 12k edges), `createEvidence` (immutable, provenance, integrity hash),
`linkEvidenceToFinding`, `computeEvidenceConfidence` (type-reliability model),
`getEvidenceChain`, `compareIterationEvidence` (type-set diff across iterations).
Screenshot persistence pattern: `replay.saveScreenshot` → artifacts + dataUrl.

## 4. Existing regression functionality

- Iteration convergence counts fixed/remaining/newRegressions (mission-level).
- Cron scheduler → `runTestSuite` → regressionStore trend (schedule-scoped).
- NO finding-keyed selection: test cases carry `findingIds[]` (bidirectional link)
  but nothing selects "tests covering finding X" or an impacted-area set.

## 5. Existing knowledge storage

Phase 3 `knowledge.js`/`knowledgeModel.js`: patterns LRU 500, write at finalize
(defects only), validate via finding-text similarity, confidence model with
recency decay + validation bonuses, `generateExplorationHints` injected into
missions/revalidations. **No fix-outcome knowledge** exists.

## 6. Existing APIs

151 routes. v1 mission/evidence-chain/webhook routes gated by
`requireIntegrationAuth` (+ JWT workspace/project scoping; legacy bearer fallback;
open only when no token configured). Findings CRUD + intelligence routes use the
dashboard token. Correlation-ID middleware on all. Idempotency: mission-create
`idempotencyKey` + `findByIdempotencyKey`; running-guard 409 on mission
revalidate; double-finalize guards. Webhooks: HMAC-signed, retrying, additive.
⚠️ Pre-existing hole: `PATCH /api/findings/:id/status` (index.js:1538) has NO auth
middleware — Phase 18 adds token auth to this sibling group (documented, not
silently).

## 7. Existing UI

`public/bugs.js` bug-detail modal: lifecycle/review badges, Bug Intelligence grid,
review row (Confirm/FP/Dup/Needs-info + enrichment "Revalidate"), steps,
expected/actual, typed-evidence panel, duplicates, linked tests, comments, dev
analysis, history timeline, status dropdown. `public/pipeline.js` loop panel
(iteration history, convergence, revalidate button). `public/app.js` Phase 17 UX
panel + review actions (the review-gated modal pattern). NO fix-validation UI.

## 8. Existing tests

43 files, ~1,045 cases, all green at Phase 17 baseline. Phase 17 suites (110
tests) are the frozen regression baseline. Harness patterns: env-driven E2E
against live server + benchmark apps on :9901-9905; unit suites import modules
directly.

## 9. Missing capabilities (the genuine gaps)

A. Fix-validation run store + stable IDs + async job statuses.
B. Fix-status classification enum + deterministic engine (none of
   VERIFIED_FIXED/STILL_BROKEN/PARTIALLY_FIXED/REGRESSED/UNABLE_TO_VERIFY exist).
C. Finding/workflow → deterministic re-execution bridge (plan generation).
D. Finding-level before/after evidence comparison.
E. Attempt aggregation (attempts/successes/reproductionRate/time-to-verify).
F. Risk-based regression selection for a fix (findingIds join, workflow/feature
   neighbors).
G. Validation confidence (separate measurement from finding confidence).
H. Knowledge updates gated on trustworthy fix outcomes.
I. Fix-validation UI (badge, panel, actions, before/after view).
J. Idempotency-Key support + async validation status resource.

## 10. Files to modify

- `server/index.js` — new v1 routes + dashboard route + boot-time load + (auth
  fix on the legacy status route).
- `server/findings.js` — additive `fixStatus`/`validationCount`/`lastValidationId`
  pointer fields via a guarded setter (no existing field semantics change).
- `public/bugs.js` + `public/index.html` (+ styles) — FIX VALIDATION section,
  before/after view, board filter.
- `.gitignore` — nothing (already covers .qase).
- `package.json` — NO dependency changes.

## 11. Files that must remain untouched

All phase16/phase17 modules except additive imports in index.js: findingIntelligence.js,
findingEnrichment.js, uxSweep.js, uxChecks.js, uxModel.js, uxFriction.js,
qualityAssessment.js, featureGapValidation.js, recommendationEngine.js,
uxAssessment.js; evidenceGraph.js (read-only usage + new SCREENSHOT nodes via its
public API); replay.js, validationLoop.js, knowledge.js (read/verify via public
APIs only). Store files: findings.json schema unchanged apart from additive
pointer fields.

## 12. Conclusion

Reuse: mission revalidate guard patterns, replay engine, evidence graph, finding
lifecycle machine, knowledge validation machinery, UX-assessment store pattern
(the established additive-store precedent), bug-detail modal pattern, benchmark
harness (incl. `app7-contactvault-fixed.html` — a pre-existing FIXED variant app
perfect for fix-validation scenarios). Implement: the 10 gaps A–J. No duplicate
functionality.
