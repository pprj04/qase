# Phase 2 — Application Understanding Architecture

## 1. Overview

Phase 2 introduces a real Application Understanding capability to QASE. The system now builds a **structured Application Model** from multiple evidence sources — mission context, static exploration data, interactive signals, and optional LLM reasoning — before downstream capabilities consume it.

**Core principle: Purpose is an OUTPUT of understanding, not an input.**

The existing heuristic purpose detection (~43% accuracy) is preserved as a fallback layer. The new understanding engine wraps it in a multi-source evidence pipeline that can override, refine, or corroborate the heuristic baseline.

## 2. Evidence Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     Evidence Sources                          │
├─────────────────┬──────────────────┬─────────────────────────┤
│ Mission Context │ Static Evidence  │ Interactive Evidence     │
│ (User Intent)   │ (Inventory)      │ (Browser Steps)          │
├─────────────────┼──────────────────┼─────────────────────────┤
│ buildPrompt     │ extractAppInv    │ extractInteractiveSignals│
│ requirements[]  │ - pages          │ - verifiedAuth           │
│ businessGoals   │ - forms          │ - verifiedFeatures       │
│ targetUsers     │ - auth           │ - brokenFeatures         │
│ expectedFeatures│ - capabilities   │ - pageTransitions        │
│ knownFlows      │ - appType        │ - activities             │
└────────┬────────┴────────┬─────────┴───────────┬─────────────┘
         │                 │                     │
         ▼                 ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│                  buildAppUnderstanding()                      │
│                   (appUnderstanding.js)                       │
├─────────────────────────────────────────────────────────────┤
│ 1. Collect static evidence (inventory)                        │
│ 2. Collect interactive signals                                │
│ 3. Query knowledge layer for metadata hints                   │
│ 4. Run heuristic purpose detection (baseline)                 │
│ 5. (Optional) Structured LLM reasoning with web sanitization  │
│ 6. Build feature model (expected/observed/verified/broken)    │
│ 7. Build workflow model (expected/observed/verified/missing)  │
│ 8. Identify roles from context + navigation + auth evidence   │
│ 9. Detect conflicts (context vs heuristic, marketing vs fn)   │
│ 10. Build explainable confidence model                        │
│ 11. Identify unknowns (things not enough evidence to classify) │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Structured Application Model                     │
│                    (appModel.js)                              │
├─────────────────────────────────────────────────────────────┤
│ purpose:   { id, name, source, confidence }                   │
│ roles:     [ { id, name, source, evidence } ]                 │
│ features:  [ { name, status, source, evidence } ]             │
│             status: expected | observed | verified |          │
│                      broken | unverified                      │
│ workflows: [ { name, status, steps: [step], source } ]        │
│             step.status: observed | verified |                │
│                         missing | failed | not_tested         │
│ unknowns:  [ { description, impact, category } ]              │
│ conflicts: [ { description, sources, resolution } ]           │
│ confidence: {                                                 │
│   overall: float,                                            │
│   purpose: { score, basis: string },                         │
│   features: { score, basis: string },                        │
│   workflows: { score, basis: string },                       │
│   roles: { score, basis: string },                           │
│   identity: { score, basis: string },                        │
│ }                                                             │
│ evidence:  [ { source, type, description, timestamp } ]      │
└────────────────────────┬────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ feature_gap  │ │ dev_intel    │ │ UI / API     │
│ (downstream) │ │ (downstream) ││ (display)     │
└──────────────┘ └──────────────┘ └──────────────┘
```

## 3. Component Architecture

### 3.1 Application Model (server/appModel.js)

The Application Model is a structured data object that separates knowledge into four epistemic tiers:

| Tier | Meaning | Color |
|------|---------|-------|
| **INTENT** | What the user/mission says the app should be | Blue |
| **OBSERVED** | What was directly observed during exploration | Green |
| **INFERENCE** | What we derived from reasoning (heuristic + LLM) | Orange |
| **UNKNOWN** | What we don't have enough evidence to classify | Gray |

**Feature Statuses:**
- `expected` — in mission context but not observed (INTENT)
- `observed` — seen during exploration but not verified (OBSERVED)
- `verified` — observed AND functionally tested (OBSERVED + INTENT)
- `broken` — detected but failed during testing (OBSERVED)
- `unverified` — detected but not tested (OBSERVED)

**Workflow Step Statuses:**
- `observed` — seen in agent steps
- `verified` — tested with successful outcome
- `missing` — not found during exploration
- `failed` — attempted but failed
- `not_tested` — expected but never attempted

**Key Functions:**
- `createAppModel()` — factory for empty model with schema defaults
- `validateAppModel(model)` — schema validation with error reporting
- `makeConfidence(score, basis)` — explainable confidence (score + human-readable reason)
- `addEvidence(model, source, type, description)` — evidence tracker with auto-timestamp
- `addUnknown(model, description, impact, category)` — explicit unknowns
- `addConflict(model, description, sources, resolution)` — conflict tracking
- `determineStatus(expected, observed, verified, broken)` — status resolver
- `summarizeAppModel(model)` — compact summary for pipeline/UI
- `serializeAppModel(model) / deserializeAppModel(json)` — JSON persistence

### 3.2 Understanding Engine (server/appUnderstanding.js)

The understanding engine is the orchestrator that aggregates evidence and builds the model.

**Evidence Collection:**
1. **Mission context** — user-provided intent (buildPrompt, requirements, businessGoals, targetUsers, expectedFeatures, knownFlows)
2. **Static exploration** — `extractAppInventory()` from featureGap.js (pages, forms, auth, capabilities, appType)
3. **Interactive signals** — `extractInteractiveSignals()` from featureGap.js (verifiedAuth, verifiedFeatures, brokenFeatures, pageTransitions)
4. **Knowledge layer** — `detectAppMetadata()` + `queryKnowledge()` from knowledge.js (framework hints, auth provider, matched patterns)
5. **Heuristic baseline** — `inferAppPurpose()` from featureGap.js (preserved as fallback, ~43% accuracy)
6. **LLM reasoning** (optional) — structured prompt with sanitized web content, strict JSON schema validation

**Model Building:**
- `buildFeatureModel()` — merges expected (from context + purpose templates), observed (from inventory), verified/broken (from interactions)
- `buildWorkflowModel()` — matches purpose templates to observed steps, classifies each step as observed/verified/missing/failed/not_tested
- `identifyRoles()` — derives user roles from context (targetUsers), navigation patterns (login/register/logout pages), and auth evidence
- `detectConflicts()` — flags disagreements between context purpose and heuristic purpose, or marketing-page structure vs functional features
- `buildConfidenceModel()` — computes per-category confidence with explainable basis
- `identifyUnknowns()` — flags areas where evidence is insufficient to make a determination

**LLM Security:**
- `sanitizeWebContent()` — strips instruction-like patterns from web content before passing to LLM. Removes:
  - `ignore previous instructions`
  - `you are now...`
  - `system:`, `assistant:`, `user:`, `role:` prefixes
  - HTML/JS tags
  - `javascript:` and `data:` URLs
- LLM output parsed as strict JSON, validated against expected schema
- LLM results treated as INFERENCE layer (not INTENT or OBSERVED)

### 3.3 Pipeline Integration

**Pipeline order (9 stages):**
```
1. workflow_save          (persists workflows)
2. test_generation        (generates test cases)
3. smoke_run              (runs quick smoke tests)
4. schedule_create        (creates schedules)
5. dev_intelligence       (analyzes findings)
6. application_understanding  ← NEW
7. feature_gap            (now depends on application_understanding)
8. mission_finalize       (finalizes mission)
9. knowledge_write        (extracts patterns)
```

**Dependency change:**
- `feature_gap` previously had `dependsOn: []`
- `feature_gap` now has `dependsOn: ['application_understanding']`
- This ensures the app model is built BEFORE feature gap analysis runs
- The orchestrator's topological sort handles this automatically

**Data flow:**
- `application_understanding` produces `session.pipeline.summary.appUnderstanding`
- `feature_gap` can access `session.pipeline.summary.appUnderstanding.appModelSummary`
- Feature gap uses the app model's purpose and feature classification to enrich its gap analysis

### 3.4 API + UI

**API:**
- `GET /api/sessions/:id/app-understanding` — returns the full app model for a session

**UI (public/pipeline.js):**
- Application Understanding section rendered in the session detail view
- Shows: purpose (id + name + source), overall confidence, feature counts (expected/observed/verified/broken), workflow summary, unknowns, conflicts
- Loaded asynchronously after session loads, cached in `cachedAppModel`

## 4. Confidence Model

Confidence is explainable. Each category has a score (0.0–1.0) and a basis string explaining WHY.

**Overall Confidence Factors:**
| Factor | Weight | Logic |
|--------|--------|-------|
| Has mission context | +0.1 | `context.description` or `context.buildPrompt` present |
| Has interactive evidence | +0.1 | At least 3 verified features |
| Has static evidence | +0.1 | Inventory has pages and forms |
| Has multiple agreeing sources | +0.1 | Context purpose == heuristic purpose |
| Conflict penalty | -0.1 per conflict | Max -0.2 |
| Unknowns penalty | -0.02 per unknown | Max -0.1 |
| Exploration confidence | multiplier | `report.confidence` or 0.5 default |
| LLM agreement bonus | +0.05 | LLM purpose matches heuristic (if LLM ran) |

**Per-Category Basis Examples:**
- Purpose: "Keyword matching found 7 signal matches for saas_platform, corroborated by verified auth and dashboard"
- Features: "8 expected from context, 4 observed in inventory, 1 verified through interaction"
- Workflows: "3 workflow templates matched, 8 steps observed, 2 verified"
- Roles: "1 role identified from context.targetUsers, corroborated by login/register pages"
- Identity: "Application type: saas_platform. Auth detected: login form with email+password"

## 5. Security Considerations

### Prompt Injection Defense

Web content from the target application is treated as **untrusted data**. Before any content is passed to the LLM:

1. **sanitizeWebContent()** strips:
   - Role-injection patterns (`system:`, `assistant:`, `user:`, `role:`)
   - Instruction overrides (`ignore previous`, `you are now`, `act as`)
   - Executable content (HTML tags, `<script>`, `javascript:`)
   - Repeated whitespace (limits prompt size)

2. **LLM output is validated** as strict JSON with expected schema fields. Invalid JSON → fallback to heuristic-only.

3. **LLM results are tier INFERENCE** — they never override OBSERVED or INTENT evidence directly.

### Data Isolation

- Each session builds its own app model independently
- No cross-session contamination (sessions are isolated objects)
- Model is serialized as JSON and persisted with the session

## 6. Non-Goals (Explicitly Excluded)

- **No dynamic orchestration** — pipeline order is fixed topological sort
- **No Knowledge Layer v2** — existing knowledge.js is queried, not replaced
- **No Decision Engine** — no decision-making beyond confidence + conflict detection
- **No AI Studio integration** — LLM uses existing provider config
- **No continuous regeneration** — model built once per session
- **No auth/UI/browser/agent redesign** — minimal touch to existing systems
- **No multi-agent** — single understanding engine
- **No Phase 1 rewrite** — Phase 1 reliability guarantees preserved
- **No heuristic replacement** — heuristics preserved as fallback layer

## 7. Performance Characteristics

| Metric | Value | Notes |
|--------|-------|-------|
| Avg build time (no LLM) | 1.59 ms | 50-step session, 10 iterations |
| P50 build time | 1.36 ms | |
| Max build time | 4.36 ms | Worst case observed |
| Pipeline overhead | 21.1% | Of full 9-stage pipeline time |
| Memory per model | <2 KB | Serialized JSON |
| Test count added | 75 | 374 total (was 299) |

## 8. Test Coverage

| Test File | Tests | Coverage |
|-----------|-------|----------|
| tests/phase2-app-model.test.js | 21 | Model schema, validation, confidence, evidence, serialization |
| tests/phase2-app-understanding.test.js | 41 | Evidence collection, feature model, workflow model, roles, conflicts, unknowns, marketing detection, security |
| tests/phase2-validation.test.js | 13 | 10 app types with ground truth + 3 integration tests |
| **Total Phase 2** | **75** | |
