# Phase 2 — Application Understanding Spec

## Task
Build a real Application Understanding capability for QASE. The system must understand what an application is, its purpose, roles, features, workflows, unknowns, and confidence — with evidence supporting each conclusion.

## Acceptance Criteria

### Core Model
- [ ] AC1: Application Model separates INTENT / OBSERVED / INFERENCE / UNKNOWN tiers
- [ ] AC2: Features have statuses: expected / observed / verified / broken / unverified
- [ ] AC3: Workflow steps have statuses: observed / verified / missing / failed / not_tested
- [ ] AC4: Purpose is an OUTPUT of understanding, not an input
- [ ] AC5: Confidence is explainable — every score has a human-readable basis string

### Evidence Collection
- [ ] AC6: Consumes mission context (buildPrompt, requirements, businessGoals, targetUsers, expectedFeatures, knownFlows)
- [ ] AC7: Aggregates static evidence via extractAppInventory (pages, forms, auth, capabilities, appType)
- [ ] AC8: Aggregates interactive evidence via extractInteractiveSignals (verifiedAuth, verifiedFeatures, brokenFeatures, pageTransitions)
- [ ] AC9: Existing heuristic (inferAppPurpose) preserved as fallback layer (~43% accuracy)
- [ ] AC10: Optional LLM reasoning with strict JSON schema validation

### Feature & Workflow Models
- [ ] AC11: Feature model distinguishes expected (from context), observed (from inventory), verified (tested successfully), broken (tested with failure)
- [ ] AC12: Workflow model matches templates to observed steps, classifies each step status
- [ ] AC13: Explicit unknowns — things with insufficient evidence are labeled, not guessed
- [ ] AC14: Conflict detection — flags when context disagrees with heuristic, or marketing structure vs functional features

### Security
- [ ] AC15: Prompt injection defense — sanitizeWebContent strips instruction patterns before LLM
- [ ] AC16: LLM output validated as strict JSON, fallback to heuristic on failure
- [ ] AC17: Web content treated as untrusted data (tier INFERENCE, never overrides OBSERVED)

### Integration
- [ ] AC18: application_understanding capability registered in pipeline (9th stage)
- [ ] AC19: feature_gap depends on application_understanding
- [ ] AC20: Minimal API endpoint: GET /api/sessions/:id/app-understanding
- [ ] AC21: Minimal UI exposure in session detail view
- [ ] AC22: Evidence lineage — every conclusion traces back to source evidence

### Quality Gates
- [ ] AC23: Phase 1 regression — 299/299 tests still pass
- [ ] AC24: 5+ app type validation with ground truth
- [ ] AC25: Performance measured (build time overhead)
- [ ] AC26: No architecture redesign, no new AI capabilities, no heuristic replacement without fallback
- [ ] AC27: 3 documentation files + architecture updates

## Key Constraints (Non-Negotiable)
- No Phase 3, no dynamic orchestration, no Knowledge Layer v2, no Decision Engine
- No AI Studio integration, no continuous regeneration
- No auth/UI/browser/agent redesign, no multi-agent
- No Phase 1 rewrite, no removing existing capabilities
- No replacing heuristics without fallback
- Preserve Phase 1 frozen baseline (299/299 tests)
