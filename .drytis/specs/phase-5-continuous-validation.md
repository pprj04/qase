# Phase 5 — Continuous Validation Loop

## Objective

Transform QASE from a one-shot validation system into a controlled validation cycle:

    Mission → Explore → Quality Assessment → Decision Engine → Action → Revalidate → Compare → Decision

## Architecture

The Validation Loop sits OUTSIDE the pipeline — it orchestrates across multiple pipeline runs:

    Mission
       ↓
    ┌─────────────────────────────────────────┐
    │           Validation Loop                │
    │                                          │
    │  Iteration 1 → Pipeline → Iteration 2   │
    │       ↓                    ↓            │
    │  Quality/Decision    Quality/Decision   │
    │       ↓                    ↓            │
    │       └── Comparison + Convergence ──┘  │
    │                    ↓                     │
    │              Next Action                 │
    └─────────────────────────────────────────┘

Pipeline order unchanged (10 stages):
  workflow_save → test_generation → smoke_run → schedule_create → dev_intelligence
  → application_understanding → feature_gap → mission_finalize → decision_engine → knowledge_write

## Data Model

### Iteration (stored in mission.iterations[])
    {
      number:       number,
      sessionId:    string,
      findings:     Finding[],
      qualityScore: number (0-100),
      verdict:      'pass' | 'pass_with_issues' | 'fail',
      releaseReady: boolean,
      improvementPrompt: string,
      ranAt:        ISO timestamp,
      status:       string
    }

### Iteration Metadata (stored in mission.iterationMetadata[])
    {
      number:       number,
      sessionId:    string,
      startedAt:    number (epoch ms),
      completedAt:  number (epoch ms) | null,
      status:       ITERATION_STATUS,
      qualityScore: number | null,
      verdict:      string | null,
      decision:     Decision | null,
      duration:     number | null
    }

### Convergence
    {
      state: 'improving' | 'stable' | 'declining' | 'regression' | 'no_improvement' | 'insufficient_data',
      trend: string,
      scoreDelta: number,
      fixedCount: number,
      remainingCount: number,
      newCount: number,
      regressionCount: number,
      criticalRegressions: boolean,
      iterationsWithoutImprovement: number,
      detail: string
    }

## API Endpoints

- POST /api/v1/missions/:id/revalidate — trigger a new validation iteration
- GET  /api/v1/missions/:id/loop-status — full validation loop state
- GET  /api/v1/missions/:id/validation-comparison — comparison + convergence

## Limits & Safety

- DEFAULT_MAX_ITERATIONS = 5
- NO_IMPROVEMENT_THRESHOLD = 3 (consecutive iterations without meaningful improvement)
- MEANINGFUL_IMPROVEMENT_DELTA = 5 (score points)
- Duplicate concurrent iteration prevention (409 if mission is running)
- Decision Engine remains the single authority for pass/fail decisions
- Decision Engine failure → ESCALATE (never silent PASS)

## Decision Engine Integration

The Decision Engine is NOT modified. The Validation Loop:
1. Runs the pipeline (which includes the Decision Engine capability)
2. Reads the Decision Engine's output from the pipeline summary
3. Uses resolveAction() to translate the decision into an action
4. Does NOT re-evaluate quality or make its own pass/fail decisions

## Files

- server/validationLoop.js — main implementation (~641 lines)
- server/missions.js — recordIteration, updateMission (added stopReason, iterationMetadata)
- server/index.js — API endpoints, finalizeMissionFromSession integration
- public/pipeline.js — loadLoopStatus, renderLoopSection
- public/index.html — loop-section div
- public/styles.css — Phase 5 CSS classes
- tests/phase5-validation-loop.test.js — 49 unit tests
- tests/phase5-api.test.js — 13 API integration tests
