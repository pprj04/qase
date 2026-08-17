# Phase 8 — Mission Intent & Application Understanding

## Objective
Enable QASE to answer: What was the user asking to build? What kind of app is this? What are expected capabilities? What actually exists? What's missing? What's broken? What evidence supports the conclusion? How confident are we?

## Architecture
```
BUILD PROMPT + REQUIREMENTS + OBJECTIVES
    → APPLICATION MODEL 2.0 (purpose, domain, roles, entities, workflows, expected features, risk areas)
        → EXPECTED VS OBSERVED ENGINE
            → BUGS, FEATURE GAPS, WORKFLOW GAPS
                → EVIDENCE → QUALITY ASSESSMENT
```

## Steps

### Step 1 — Mission Intent Model
- Add intent fields to mission context: buildPrompt, requirements, objectives, expectedFeatures, expectedWorkflows, businessGoals, targetAudience, userRoles, constraints
- Gracefully handle: full prompt, prompt+requirements, requirements only, URL only
- `intentAvailability = "unknown"` when no intent provided

### Step 2 — Intent Provenance
- Every expected feature/workflow has: source (EXPLICIT/INFERRED/DOMAIN_STANDARD/UNKNOWN), confidence, evidenceRefs

### Step 3 — Application Model 2.0
- Extend existing appModel.js with: purpose (with evidence), domain, appType, audience, userRoles, entities, workflows, integrations, riskAreas
- Every conclusion has evidence references

### Step 4 — Domain Understanding
- Multi-signal domain classification: mission intent + app text + routes + UI structure + entities + workflows + browser behavior + knowledge + LLM
- Require evidence agreement; mark uncertainty explicitly

### Step 5 — Hypothesis-Based Understanding
- Generate multiple domain hypotheses → collect evidence → select best-supported
- domain = "unknown" if confidence low

### Step 6 — Expected Feature Model
- Each expected feature: id, name, description, source, priority, confidence, evidenceRefs
- Priority order: explicit requirements > build prompt > objectives > domain expectations > knowledge

### Step 7 — Observed Feature Model
- For every observed feature: feature, exists, functional, tested, evidenceRefs, confidence
- Distinguish PRESENT from FUNCTIONAL

### Step 8 — Expected vs Observed Engine
- IMPLEMENTED, IMPLEMENTED_BUT_BROKEN, PARTIALLY_IMPLEMENTED, MISSING, NOT_TESTED, NOT_APPLICABLE, UNKNOWN
- Don't call "missing" if never tested

### Step 9 — Workflow Model
- Workflow steps with: expected, observed, tested, outcome, evidence

### Step 10 — Intent-Aware Exploration
- Pass mission intent to agent context (buildQaContext + buildMissionPrompt)
- Agent prioritizes intent-specified features but still explores beyond

### Step 11 — Knowledge Integration
- Knowledge influences: domain hypotheses, risk areas, exploration hints, expected workflows
- Knowledge is NOT truth; current evidence can contradict it
- Record: knowledgeUsed, knowledgeSupported, knowledgeContradicted

### Step 12 — LLM Integration
- LLM for structured reasoning, validated against schema
- Deterministic fallback when LLM unavailable
- LLM free-form prose never directly modifies application state

### Step 13 — Confidence Model
- Multi-factor: intent evidence, static evidence, interactive evidence, consistency, knowledge agreement, LLM confidence, contradictions
- Low evidence → LOW; strong multi-source → HIGH; contradiction → reduced

### Step 14 — Domain Confusion Guard
- MetricsPro must NOT produce GitHub feature hallucinations
- Mandatory regression test

### Step 15 — ShopHub Missing-Feature Test
- With build intent provided, QASE must distinguish expected vs observed for e-commerce features
- 0% → materially improved

### Step 16 — Duplicate Suppression
- Correlate findings: one root cause + multiple supporting observations
- Preserve original observations, evidence, timestamps, artifacts
- Only collapse duplicate presentation

### Step 17 — Mission Lifecycle Reliability
- All terminal paths finalize mission correctly
- No stuck "running" missions
- Test idempotency

### Step 18 — Regression Benchmark
- Re-run all 5 Phase 7 benchmarks with intent provided
- Compare Phase 7 vs Phase 8 across 10 metrics
- Must NOT regress bug-finding capability

### Step 19 — Test Matrix
- 17 test scenarios (A-Q) covering edge cases

### Step 20 — UI Validation
- Minimal changes to expose: INTENT, UNDERSTANDING, EXPECTED, OBSERVED, GAPS, BUGS, EVIDENCE, CONFIDENCE

### Step 21 — Security/Trust
- App content never treated as instructions
- Knowledge/LLM/user content never bypasses mission policy

## Acceptance Criteria

- [ ] Mission intent model exists
- [ ] Build prompt can be passed to a mission
- [ ] Requirements/objectives/businessGoals accepted
- [ ] Intent provenance (EXPLICIT/INFERRED/DOMAIN_STANDARD/UNKNOWN)
- [ ] Application Model with purpose/domain/workflows/features
- [ ] Multi-evidence-source understanding
- [ ] Domain hypotheses supported by evidence
- [ ] Domain confusion guard works (MetricsPro regression)
- [ ] Expected feature model with provenance
- [ ] Observed feature model (PRESENT ≠ FUNCTIONAL)
- [ ] Expected vs observed: IMPLEMENTED/BROKEN/PARTIAL/MISSING/NOT_TESTED/UNKNOWN
- [ ] Workflow model
- [ ] Intent influences agent exploration
- [ ] Knowledge influences planning (not truth)
- [ ] LLM schema validated, deterministic fallback
- [ ] Confidence explainable
- [ ] Duplicate findings correlated
- [ ] Evidence preserved after dedup
- [ ] Mission lifecycle: 5/5 benchmark missions finalize
- [ ] ShopHub: 0% → materially improved missing-feature recall
- [ ] Missing-feature recall: 43% → materially improved
- [ ] MetricsPro: no GitHub hallucinations
- [ ] Bug recall: not materially regressed from 69%
- [ ] Full regression suite passes
- [ ] Phase 7 benchmark passes again

## Acceptance Thresholds

- Domain understanding: ≥70% on benchmark
- Missing-feature recall: materially above 43%
- ShopHub: no longer 0% with intent provided
- False-positive rate: ≤13% or documented reason
- Duplicate rate: materially below 23%
- Bug recall: not materially below 69%
- Mission completion: 5/5
