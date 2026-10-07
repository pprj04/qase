# Ticket #14650 re-review — NIHARIKA, 2nd round (2026-10-06)

## Verdict: PASS (previous FAIL resolved; 3 minor WARNs remain)

### CRITICAL resolved: app.js runFixtureVerification re-resolves full fixture
app.js:710-722 now does `getDefectFixture(fixture?.id)` before calling
`verifyFixtureAgainstProfile`; unknown id → honest NOT_VERIFIED with error string.
EMPIRICALLY CONFIRMED against live server, replicating app.js wiring exactly
(stripped listDefectFixtures() summary → resolve → run):
- iPhone 17 Pro (webkit): TRUE, evidence {buttonBottom:866, trayTop:694}, expected=EXPECTED
- iPad Pro 12.9 (ENV-IPADOS-IPADPRO129-1-13.0-SAF-13.0): TRUE, evidence {buttonBottom:1358, trayTop:1186}
- Windows desktop (chromium): FALSE, evidence {trayTop:0}, expected=NOT_EXPECTED
- unknown id: NOT_VERIFIED "Unknown fixture"
Regression test added in defectFixtures.test.js (asserts listing function-free, resolves
full, executes TRUE on iPhone). Full suite 1239/0/20 — matches claim.

### Residual WARN (new, minor): orchestrator `expected` label still uses stripped fixture
matrixOrchestrator.js:201 `fixtureExpectation(fixture, environment)` gets the raw summary
from hooks.verifyFixtures (no `affects`) → `expected: 'NOT_VERIFIED'` for every entry in
real runs (verified: fixtureExpectation(stripped, iphone) === 'NOT_VERIFIED'). reproduced
(the engine result) is correct; only the expectation label is degraded to NOT_VERIFIED.
Spec AC2 doesn't require the expected label → WARN not FAIL. Fix direction: have
runFixtureVerification return the resolved expectation, or resolve full fixture in the
orchestrator. matrixOrchestrator.test.js still uses fake hooks with inline affects, so the
orchestrator test masks this.

### Still-open WARNs from round 1 (unchanged, confirmed)
- No test asserts artifactRefs on a FAILED item (grep artifactRefs/collectArtifacts in
  matrix* tests: 0 hits). Code path verified by reading only.
- `services.artifacts` exists only in localServices — 0 hits in postgresServices.js;
  postgres-mode runs record empty artifactRefs silently (#14649 round-4 WARN).
- Work still uncommitted on NIHARIKA (31 commits ahead of origin/DEV).
