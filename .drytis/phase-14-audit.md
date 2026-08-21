# Phase 14 — Application Understanding & Risk-Based Test Planning
## Step 0: Read-Only Audit

**Date:** 2025-11-20
**Status:** Audit complete — root cause identified, implementation plan defined

---

## Executive Summary

QASE has a sophisticated **post-exploration** understanding engine (`appUnderstanding.js`, 1076 lines) that builds a rich Application Model with purpose, features, workflows, confidence, and evidence. It also has an LLM-enhanced purpose detection path (`derivePurposeWithLLM`). 

**The critical problem:** none of this reaches the autonomous agent. The understanding is built AFTER the agent finishes exploring. The agent explores blind — guided only by a static prompt (`buildQaContext`) and one-shot knowledge hints. There is no risk model. There is no adaptive priority during execution.

---

## Answers to 10 Audit Questions

### 1. How is application type detected?

**Heuristic only.** Two systems:

| System | Location | Method |
|--------|----------|--------|
| `detectAppMetadata()` | `knowledge.js:152-188` | Regex/keyword scan of targetUrl, missionName, buildPrompt, steps, activities, report text |
| `extractAppInventory()` | `featureGap.js:220-342` | URL patterns + capability detection → `inventory.appType` boolean map (ecommerce, saas, marketing, social, dashboard) |

No LLM involvement in type detection.

### 2. How are features detected?

Four sources, merged in `buildFeatureModel()` (`appUnderstanding.js:224-330`):

| Source | Location | Reliability |
|--------|----------|-------------|
| Context-derived | `featureGap.js:1041` `deriveContextFeatures()` | 1.0 (user ground truth) |
| Observed (heuristic) | `featureGap.js:220` `extractAppInventory()` | Medium |
| Purpose-driven expected | `featureGap.js:686` `generateExpectedFeatures()` | Scaled by purpose × exploration confidence |
| LLM-detected | `appUnderstanding.js:682` `derivePurposeWithLLM()` | **NOT merged into feature model** — stored only in `purpose.llmResult.detectedFeatures` |

### 3. How are routes/pages discovered?

**Reconstructed from agent step history only.** `collectObservedEvidence()` (`appUnderstanding.js:82-194`) builds a `pageMap` from `session.capturedSteps` — pages where steps occurred + pages navigated to via `urlAfter`. No systematic route discovery (no sitemap parsing, no link enumeration).

### 4. How are expected features generated?

`generateExpectedFeatures()` (`featureGap.js:686-798`) looks up the inferred purpose in `PURPOSE_CATALOG` (11 entries: crm, admin_dashboard, ecommerce, saas_platform, marketing, content, social, cms, project_management, developer_platform, productivity). Each catalog entry declares expected features with category/severity. Confidence = `base × purpose.confidence × explorationConfidence`.

### 5. How is confidence calculated?

`computeConfidence()` (`appUnderstanding.js:792-918`) — hand-tuned weighted heuristics:

```
overall = purpose × 0.35 + features × 0.25 + workflows × 0.15 + context × 0.25
```

All values scaled by explorationConfidence (0.2–1.0 based on step/page count). No statistical model.

### 6. How does evidence support understanding?

Flat append-only log on the model. `addEvidence()` (`appModel.js:179-189`) creates entries: `{ id, source, type, description, timestamp }`. Sources: `mission_context | static | interactive | knowledge | heuristic | llm`. 

**Limitation:** Evidence items are NOT cross-referenced by individual features or conclusions. No evidence graph linking a finding to its supporting evidence by ID.

### 7. Where does LLM understanding exist?

| Caller | Location | Output |
|--------|----------|--------|
| `derivePurposeWithLLM()` | `appUnderstanding.js:578-688` | App purpose + detectedFeatures + unknowns (stored in model, NOT fed to agent) |
| `enhanceGapsWithLLM()` | `featureGap.js:1206-1287` | Additional missing features (merged into gaps) |

LLM input is structured evidence summaries (sanitized via `sanitizeWebContent`), never raw page content.

### 8. CRITICAL: Does LLM understanding reach autonomous execution?

**NO.** The call chain:

```
Agent calls finish_qa_report
  → runAutonomyPipeline(session) [qaTools.js:120, fire-and-forget]
    → capabilities.js runAutonomyPipeline() [L654]
      → orchestrator.execute()
        → capability 'application_understanding' [L372-414]
          → buildAppUnderstanding(session, missionContext, {useLLM}) [L387]
            → derivePurpose(model, useLLM) [L1012]
              → derivePurposeWithLLM(model) [L471]  ← LLM call
        → session.appModel = result [L392]
```

The App Model is built **AFTER** the agent finishes exploring. The agent never sees it.

**The per-turn context** (`buildQaContext()` in `prompt.js`) is completely **static** — same generic brief every turn: role definition, target URL, credential placeholder names, current browser URL, tool list, generic "how to work" instructions. No purpose, no features, no risk, no knowledge patterns.

**Knowledge hints** are injected once at mission start (appended to `taskPrompt`) but NOT in `buildQaContext()`. After turn 1, they're gone from the agent's context.

### 9. How does knowledge currently influence the agent?

```
Mission start (index.js:1657)
  → detectAppMetadata({targetUrl, missionName, buildPrompt})
  → queryKnowledge(appMeta)
  → generateExplorationHints(relevantPatterns)
  → appended to taskPrompt (ONE TIME)
```

After turn 1, the agent no longer sees knowledge hints because `buildQaContext()` doesn't include them. Knowledge has the lowest priority weight (5) in workflow scoring.

### 10. Where are test priorities currently determined?

`prioritizeWorkflows()` (`workflowEngine.js:369-435`) — deterministic scoring:

| Signal | Weight |
|--------|--------|
| Explicit user requirement | 40 |
| Previously failed | 30 |
| Auth-dependent | 25 |
| Critical path | 20 |
| Business goal aligned | 15 |
| Domain standard | 10 |
| Knowledge-based | 5 |

Top 8 workflows injected as text via `buildWorkflowContextForPrompt()` into `buildMissionPrompt()`. This is **static** — set once at mission start, doesn't adapt during execution. Individual features are NOT prioritized.

---

## Root Cause Analysis

The agent explores **blind** because:

1. `buildAppUnderstanding()` runs post-exploration (in `runAutonomyPipeline` triggered by `finish_qa_report`)
2. `buildQaContext()` (the per-turn context via `additionalContext` callback) is completely static
3. There is no risk model
4. Priorities are static text set at mission start
5. Knowledge hints vanish after turn 1

The existing understanding engine is excellent but **disconnected from execution**.

---

## Implementation Plan (Smallest Possible Changes)

**Constraint:** No second planning engine. No architecture redesign. Heuristic fallback required.

### Change 1: Pre-exploration understanding from mission context (NEW: `buildPreUnderstanding`)
Build a lightweight preliminary understanding from mission context (buildPrompt, requirements, appType from metadata) BEFORE exploration starts. This uses the existing `PURPOSE_CATALOG`, `deriveContextFeatures`, and `detectAppMetadata` — no new heuristic system. Output: purpose, expected features, risk areas, test priorities. All evidence-backed from context + knowledge.

### Change 2: Risk model (NEW: `riskModel.js`)
Minimum explainable risk assessment. Each risk has: area, level (HIGH/MEDIUM/LOW), reasons (bullet list). Based on: purpose catalog severity, auth presence, data modification indicators, historical findings, knowledge patterns. No arbitrary math — every risk is explainable.

### Change 3: Inject understanding + risk into the agent prompt
- **Mission start:** Add pre-understanding + risk + priorities to `taskPrompt` (alongside existing knowledge hints)
- **Per-turn:** Add a `session.testContext` object that `buildQaContext` reads — includes purpose, risk areas, current findings, priorities. Updated as the mission progresses.

### Change 4: Adaptive priority during execution
When findings are reported, update `session.testContext` to reflect what's been found and what's still untested. The agent sees this in the next turn's context.

### Change 5: Coverage/gap report at mission end
Use existing `capturedSteps`, `activities`, evidence items to identify tested vs untested areas.

---

## Files to Modify

| File | Change |
|------|--------|
| `server/riskModel.js` | **NEW** — explainable risk assessment |
| `server/preUnderstanding.js` | **NEW** — pre-exploration understanding builder |
| `server/prompt.js` | Add test context section to `buildQaContext()` |
| `server/index.js` | Call pre-understanding at mission start; update context on findings |
| `server/qaTools.js` | Update `session.testContext` when `report_finding` is called |

**Files NOT touched:** `appUnderstanding.js`, `appModel.js`, `featureGap.js`, `knowledge.js`, `knowledgeModel.js`, `decisionEngine.js`, `workflowEngine.js`, `validationLoop.js`, `agent.js` (core runtime).
