# B2 Baseline Snapshot — 2026-08-24 @ HEAD 2ae4888 (B1 frozen)

Purpose: defensible pre/post answer to "Did B2 actually make QASE more autonomous?"

## Production gate
- B1 production gate: PASSED (final full run) — all b1-* suites green, golden flow
  14/14, infra_verifier PASS, reviewer PASS (10/10), tester PASS 3/3.
- Full `run-tests.mjs gate` at B1 time: 51+ suites ✓, 3 legacy failures
  (phase10-visual-regression-v2 1f, phase11a-findings-store 4f,
  phase14-multi-viewport 1f) — pre-existing, unrelated to B1 (B0/B1-era triage;
  phase17-e2e recovered after webhook-subscription pruning, core mode all-green).
- Container restarted since (ext4 corruption recovery); services RUNNING,
  /api/health 200, preview 200, benchmarks 9901-9907 serving.

## Autonomy wiring (exact)
| Piece | Status at 2ae4888 |
|---|---|
| decisionEngine.createDecision/appendDecision | 0 production callers |
| validationLoop.resolveAction | exported, imported index.js:110, 0 call sites |
| session.testContext builder | DOES NOT EXIST (prompt reads it, nothing assigns it) |
| riskModel.assessRisk / formatRiskForPrompt / buildCoverageReport | 0 callers |
| riskModel.reassessRiskWithFindings | 1 caller (qaTools.js) — updates testContext that is never built |
| findingEnrichment | phaseRouter post-hoc only, never in agent prompts |
| appUnderstanding/appModel | mission summary bar only (capabilities.js) |
| Revalidation trigger | human/API only (revalidateMissionByIdHandler index.js:2805) |
| decision traces | none exist |

## Effective config (live)
maxTurns 120 (env QASE_MAX_TURNS=120, stored 120), concurrentRuns 3, model
z-ai/glm-5 @ https://llm.drytis.ai/v1, browserstackEnabled false, strict true.

## Behavior comparison baseline (to fill by W4)
Old loop = predetermined: prompt → SDK agent run to turn budget → findings → report.
No per-phase decision point exists. Numbers captured in W4 A/B runs.
