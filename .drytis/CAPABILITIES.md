# Qase — Capability Contracts

> Formal contract for every capability in the registry.
> Each capability is independently testable, independently deployable,
> and declares its inputs, outputs, confidence, cost, and dependencies.

---

## Capability Interface

Every capability implements this contract:

```typescript
interface Capability {
  id: string;                    // unique identifier, e.g. "app_understanding"
  name: string;                  // human-readable, e.g. "Application Understanding"

  // What this capability needs to run
  inputs: string[];              // evidence/context keys it consumes
                                 // e.g. ["mission.context", "session.capturedSteps"]

  // What this capability produces
  outputs: string[];             // evidence keys it produces
                                 // e.g. ["purpose", "inventory", "workflowMap"]

  // Dependencies — which capabilities must run first
  dependencies: string[];        // capability ids, e.g. ["step_capture"]

  // What evidence types it requires (must exist before running)
  requiredEvidence: string[];    // e.g. ["session.capturedSteps"]

  // What evidence types it produces (available for downstream capabilities)
  producesEvidence: string[];

  // How reliable is this capability's output?
  confidence: 'high' | 'medium' | 'low';

  // What does it cost to run?
  cost: {
    llm: boolean;                // does it make LLM API calls?
    browser: boolean;            // does it need browser interaction?
    duration: 'fast' | 'medium' | 'slow';
  };
}
```

---

## Registry

### 1. Step Capture

```
id:           step_capture
name:         Step Capture
inputs:       [session.capturedSteps, session.activities]
outputs:      [evidence.raw.steps]
dependencies: []
requiredEvidence: []
producesEvidence: [evidence.raw.steps]
confidence:   high
cost:         { llm: false, browser: false, duration: 'fast' }
status:       ✅ EXISTS (pipeline stage: workflow_save)
```

Captures browser actions as structured workflow steps. Already implemented.

---

### 2. Application Understanding

```
id:           app_understanding
name:         Application Understanding
inputs: [
  mission.context,           // build prompt, requirements (if provided)
  session.capturedSteps,     // what the agent did
  session.activities,        // what the agent observed
  evidence.raw.steps,        // structured step outcomes
  knowledge.patterns         // relevant known patterns (if any)
]
outputs: [
  evidence.normalized.purpose,     // { id, name, confidence }
  evidence.normalized.inventory,   // pages, forms, auth, capabilities
  evidence.normalized.workflowMap, // detected workflow steps
  evidence.graph.understandingGaps // areas needing deeper exploration
]
dependencies:  [step_capture]
requiredEvidence: [evidence.raw.steps]
producesEvidence: [
  evidence.normalized.purpose,
  evidence.normalized.inventory,
  evidence.normalized.workflowMap
]
confidence:   medium    (43% accuracy today, target >90%)
cost:         { llm: true, browser: false, duration: 'medium' }
status:       🟡 PARTIAL — purpose detection exists, interactive outcomes missing
```

Multi-source understanding:
- **Mission Context**: ground truth from build prompt (if provided)
- **Static Analysis**: page structure, DOM, text, links, forms
- **Interactive Exploration**: did login work? did search return results? did cart add?
- **Reasoning**: LLM synthesis on top of heuristic baseline
- **Knowledge**: known patterns for this framework/auth provider

Purpose **emerges** from understanding. Not inferred first.

---

### 3. Bug Detection

```
id:           bug_detection
name:         Bug Detection
inputs: [
  session.findings,
  session.capturedSteps,
  evidence.raw.steps
]
outputs: [
  evidence.normalized.bugs,        // structured bug list
  evidence.normalized.severityMap  // severity per bug
]
dependencies:  [step_capture]
requiredEvidence: [evidence.raw.steps]
producesEvidence: [evidence.normalized.bugs, evidence.normalized.severityMap]
confidence:   high
cost:         { llm: true, browser: false, duration: 'medium' }
status:       ✅ EXISTS (agent reports findings via report_finding tool)
```

Agent-driven bug detection during exploration. Each finding includes
screenshots, DOM state, console errors, reproducibility steps.

---

### 4. Feature Gap Analysis

```
id:           feature_gap
name:         Feature Gap Analysis
inputs: [
  evidence.normalized.purpose,      // from App Understanding
  evidence.normalized.inventory,    // from App Understanding
  mission.context                   // expected features from build prompt
]
outputs: [
  evidence.normalized.gaps,         // missing features list
  evidence.normalized.workflowGaps, // broken workflow steps
  evidence.graph.gapDependencies    // gap-to-gap relationships
]
dependencies:  [app_understanding]
requiredEvidence: [evidence.normalized.purpose, evidence.normalized.inventory]
producesEvidence: [evidence.normalized.gaps, evidence.normalized.workflowGaps]
confidence:   medium    (precision unmeasured on real apps)
cost:         { llm: true, browser: false, duration: 'medium' }
status:       🟡 PARTIAL — heuristic + LLM enhancement exists, needs interactive data
```

Compares expected features (from purpose + context) against actual
inventory. Flags features that should exist but don't. Also checks
workflow templates for broken sequences.

---

### 5. Root Cause Analysis

```
id:           root_cause
name:         Root Cause Analysis
inputs: [
  evidence.normalized.bugs,
  evidence.normalized.gaps,
  session.capturedSteps
]
outputs: [
  evidence.normalized.rootCauses,   // per-finding root cause
  evidence.normalized.fixPrompts,   // per-finding regeneration prompt
  evidence.graph.causeChains        // finding → root cause → fix relationships
]
dependencies:  [bug_detection, feature_gap]
requiredEvidence: [evidence.normalized.bugs]
producesEvidence: [evidence.normalized.rootCauses, evidence.normalized.fixPrompts]
confidence:   medium
cost:         { llm: true, browser: false, duration: 'medium' }
status:       ✅ EXISTS (pipeline stage: dev_intelligence)
```

Analyzes each finding for root cause, impact, and structured fix prompt.

---

### 6. Quality Assessment

```
id:           quality_assessment
name:         Quality Assessment
inputs: [
  evidence.normalized.bugs,
  evidence.normalized.gaps,
  evidence.normalized.rootCauses,
  evidence.normalized.inventory,    // for coverage calculation
  evidence.graph.*                  // all graph data
]
outputs: [
  assessment.score,               // 0-100
  assessment.coverage,            // pages, workflows, capabilities tested
  assessment.evidenceQuality,     // reproducibility, strength
  assessment.findingBreakdown,    // by severity, category
  assessment.improvementPrompt    // structured text for regeneration
]
dependencies:  [root_cause]
requiredEvidence: [evidence.normalized.bugs, evidence.normalized.gaps]
producesEvidence: [assessment.score, assessment.coverage, assessment.improvementPrompt]
confidence:   high
cost:         { llm: false, browser: false, duration: 'fast' }
status:       ✅ EXISTS (pipeline stage: mission_finalize, partially)
```

Determines **what happened**. Pure analysis — no business policy.
Score = 100 − Σ(severity × confidence) for all findings.

---

### 7. Decision Engine

```
id:           decision_engine
name:         Decision Engine
inputs: [
  assessment.score,
  assessment.coverage,
  assessment.evidenceQuality,
  mission.context,               // business goals, risk tolerance
  mission.iterations             // convergence history
]
outputs: [
  decision.verdict,              // pass | pass_with_issues | fail | regenerate | escalate
  decision.confidence,
  decision.risk,
  decision.criticalIssues[],
  decision.recommendations[],
  decision.stopReason            // approved | max_iterations | no_improvement | escalated
]
dependencies:  [quality_assessment]
requiredEvidence: [assessment.score, assessment.coverage]
producesEvidence: [decision.verdict, decision.confidence, decision.recommendations]
confidence:   high
cost:         { llm: false, browser: false, duration: 'fast' }
status:       🔴 MISSING — currently merged into mission_finalize, needs separation
```

Determines **what to do**. Business policy lives here.
Configurable: quality thresholds, risk tolerance, max iterations, escalation rules.

---

### 8. Knowledge Query (Pre-Mission)

```
id:           knowledge_query
name:         Knowledge Query
inputs: [
  mission.context,               // build prompt → framework hints
  session.targetUrl,             // URL → framework detection
  evidence.raw.steps             // early exploration data
]
outputs: [
  knowledge.patterns,            // relevant known patterns
  knowledge.capabilityHints      // "deepen auth testing" style suggestions
]
dependencies:  []
requiredEvidence: []
producesEvidence: [knowledge.patterns, knowledge.capabilityHints]
confidence:   high    (based on accumulated occurrences)
cost:         { llm: false, browser: false, duration: 'fast' }
status:       🔴 MISSING
```

Runs BEFORE other capabilities. Surfaces known patterns relevant to this
app's framework/auth provider. Influences orchestrator's capability
selection (e.g., "Clerk auth detected → run deeper auth testing").

---

### 9. Knowledge Write (Post-Mission)

```
id:           knowledge_write
name:         Knowledge Write
inputs: [
  evidence.normalized.bugs,
  evidence.normalized.gaps,
  evidence.normalized.rootCauses,
  assessment.*,
  mission.context
]
outputs: [
  knowledge.newPatterns          // patterns extracted from this mission
]
dependencies:  [quality_assessment]
requiredEvidence: [assessment.score, evidence.normalized.rootCauses]
producesEvidence: [knowledge.newPatterns]
confidence:   medium    (increases as pattern recurs across missions)
cost:         { llm: true, browser: false, duration: 'medium' }
status:       🔴 MISSING
```

Runs AFTER quality assessment. Extracts notable findings as patterns.
Stores in knowledge base for future missions.

---

### 10. Test Generation

```
id:           test_generation
name:         Test Generation
inputs: [
  session.capturedSteps,
  evidence.normalized.purpose,
  evidence.normalized.inventory
]
outputs: [
  evidence.normalized.testCases  // structured test cases for replay
]
dependencies:  [step_capture, app_understanding]
requiredEvidence: [evidence.raw.steps]
producesEvidence: [evidence.normalized.testCases]
confidence:   medium
cost:         { llm: true, browser: false, duration: 'medium' }
status:       ✅ EXISTS (pipeline stage: test_generation)
```

---

### 11. Continuous Validation

```
id:           continuous_validation
name:         Continuous Validation
inputs: [
  decision.verdict,
  mission.iterations[],
  assessment.*
]
outputs: [
  iteration.comparison,          // delta between iterations
  iteration.convergence,         // is quality improving?
  iteration.regressions          // new bugs in latest iteration
]
dependencies:  [decision_engine]
requiredEvidence: [decision.verdict]
producesEvidence: [iteration.comparison, iteration.convergence]
confidence:   high
cost:         { llm: false, browser: false, duration: 'fast' }
status:       🟡 PARTIAL — iterations + comparison built, never run live
```

If decision = regenerate, this capability manages the revalidation loop.
Compares iterations, tracks convergence, detects regressions.

---

## Capability Dependency Graph

```
                    knowledge_query
                          │
                          ▼
                    step_capture
                          │
                    ┌─────┴─────┐
                    ▼           ▼
            app_understanding   bug_detection
                    │           │
                    ▼           ▼
              feature_gap       │
                    │           │
                    └─────┬─────┘
                          ▼
                    root_cause
                          │
                    ┌─────┴─────┐
                    ▼           ▼
           quality_assessment  knowledge_write
                    │
                    ▼
              decision_engine
                    │
                    ▼
          continuous_validation
```

---

## Pluggability

New capabilities can be added without touching existing ones. Example:

```
Future capability:
  id:           accessibility_testing
  name:         Accessibility Testing
  inputs:       [evidence.raw.steps, session.capturedSteps]
  outputs:      [evidence.normalized.a11yIssues]
  dependencies: [step_capture]
  confidence:   high
  cost:         { llm: false, browser: true, duration: 'medium' }
```

Register it, declare its dependencies, the orchestrator includes it
in the plan automatically.
