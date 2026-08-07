# Qase — Architecture

> How the system is structured. Components, orchestrator, capabilities,
> execution model, data flow, data model.
> This document describes the TARGET architecture, noting what already exists
> and what needs to be built.

---

## System Diagram

```
Input Sources (AI Studio | Human | CI/CD)
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│                          MISSION                                │
│  Owns: context, objectives, constraints, iterations, verdict    │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       ORCHESTRATOR                              │
│                                                                 │
│  • Mission Planning   — what capabilities does this mission need?│
│  • Dependency Resolution — in what order?                        │
│  • Confidence Evaluation — is evidence strong enough?            │
│  • Stopping Criteria — convergence, max iterations, budget      │
│  • Retry Management   — transient failures, self-healing        │
│  • Knowledge Query    — what do we already know about this app?  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
┌──────────────────┐ ┌──────────────┐ ┌──────────────────┐
│ APP UNDERSTANDING│ │ BUG DETECTION│ │ FEATURE GAP      │
│                  │ │              │ │ ANALYSIS         │
│ Static Analysis  │ │ DOM defects  │ │                  │
│ Interactive Expl │ │ Console errs │ │ Purpose-driven   │
│ Mission Context  │ │ Visual bugs  │ │ expected vs actual│
│ Reasoning        │ │ Reproducibil.│ │                  │
└────────┬─────────┘ └──────┬───────┘ └────────┬─────────┘
         │                  │                  │
         └──────────┬───────┘──────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EVIDENCE PIPELINE                            │
│                                                                 │
│  Raw Evidence → Normalized → Evidence Graph                    │
│                                                                 │
│  Raw: screenshots, DOM snapshots, console logs, HTTP traces    │
│  Normalized: "Login failed", "Missing registration button",    │
│              "Route /checkout returns 404", "Clerk auth detected"│
│  Graph: relationships between findings (this bug blocks that    │
│         workflow step, this gap depends on that feature)        │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    KNOWLEDGE LAYER                              │
│                                                                 │
│  Read BEFORE mission:  Match app metadata → surface patterns   │
│  Write AFTER mission:  Extract findings → new patterns         │
│  Active influence:     "Known Clerk issue" → deepen auth tests │
│                                                                 │
│  Schema: { framework?, authProvider?, pattern, issue,            │
│            recommendation, fixPrompt, source, occurrences,      │
│            confidence, firstSeen, lastSeen }                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              QUALITY ASSESSMENT                                 │
│                                                                 │
│  Determines WHAT HAPPENED.                                      │
│                                                                 │
│  • Score findings by severity × confidence                      │
│  • Calculate coverage (pages explored, workflows validated)     │
│  • Identify patterns across findings                            │
│  • Assess evidence quality (reproducible? strong? weak?)       │
│                                                                 │
│  Output: quality assessment object (score, coverage, evidence   │
│         quality, finding breakdown)                             │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                 DECISION ENGINE                                 │
│                                                                 │
│  Determines WHAT TO DO.                                         │
│                                                                 │
│  • approve: quality above threshold, no critical issues         │
│  • regenerate: fixable issues found, improvement prompt ready   │
│  • escalate: requires human judgment                            │
│  • stop: max iterations reached or no improvement possible      │
│                                                                 │
│  Business policy lives here, not in assessment.                 │
│  Configurable thresholds, risk tolerance, escalation rules.     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              CONTINUOUS VALIDATION                              │
│                                                                 │
│  If decision = regenerate:                                      │
│    1. Send improvement prompt to input source (AI Studio)       │
│    2. Receive new app version (new URL / new generationId)      │
│    3. Create next iteration under same mission                  │
│    4. Run capabilities again                                    │
│    5. Compare to previous iteration                             │
│    6. Feed back to Quality Assessment + Decision                │
│                                                                 │
│  Until: approved | escalated | max iterations                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Orchestrator (Detail)

The Orchestrator is NOT a dispatcher. It is a **mission manager**.

### Responsibilities

| Responsibility | Description |
|---------------|-------------|
| **Mission Planning** | Given mission context + objectives, determine which capabilities are needed. A "full audit" mission runs all capabilities. A "security" mission runs security + app understanding only. |
| **Dependency Resolution** | Application Understanding must run before Feature Gap (can't compare expected vs actual without understanding purpose). Determine order from declared dependencies. |
| **Confidence Evaluation** | After each capability runs, evaluate evidence confidence. If below threshold, trigger deeper exploration or additional capabilities. |
| **Stopping Criteria** | Track convergence across iterations. Stop if no improvement for N iterations, or budget exhausted, or quality threshold reached. |
| **Retry Management** | Transient failures (browser crash, LLM timeout) get retried. Self-healing for broken selectors. |
| **Knowledge Query** | Before planning, query Knowledge Layer for relevant patterns. If app uses Clerk auth, schedule deeper auth testing. Knowledge influences capability selection. |

### Execution Models

**Sequential (dependency chain):**
```
App Understanding → Feature Gap → Workflow Validation → Bug Detection
```

**Parallel (independent capabilities):**
```
     ┌→ Accessibility
Mission ──┤→ Security
     │    └→ Performance
     └→ Bug Detection (started immediately)
     
     Merge Results → Quality Assessment → Decision
```

The Orchestrator chooses the model based on the capability registry's declared
dependencies.

---

## Evidence Pipeline (Detail)

Evidence is layered, not flat.

### Layer 1: Raw Evidence

What capabilities collect directly:
- Screenshots
- DOM snapshots
- Console logs
- HTTP traces / network errors
- LLM observations (natural language)

### Layer 2: Normalized Evidence

Structured facts extracted from raw evidence:
- "Login form submitted, stayed on /login — login failed"
- "Button #checkout not found in DOM"
- "Route /api/users returns 500"
- "Clerk authentication provider detected"
- "No registration page found across 15 pages explored"

### Layer 3: Evidence Graph

Relationships between findings:
- Bug A blocks Workflow Step B
- Missing Feature C depends on Missing Feature D
- Pattern E (Clerk timeout) matches Knowledge Pattern F
- Gaps and bugs in the same area indicate a broader issue

The graph makes reasoning possible: "this isn't just one broken button —
the entire checkout flow is missing."

---

## Data Model

### Mission
```
Mission {
  id, projectId, type, status, source

  context: {
    buildPrompt?,          // "Build a CRM with leads and invoicing"
    requirements?,         // ["user auth", "data export", ...]
    testCredentials?,
    businessGoals?
  }

  objectives[]             // ["full_audit", "find_missing_features"]
  capabilities[]           // which capabilities the orchestrator selected
  iterations[]: [{
    iteration, sessionId, findings[], qualityScore, timestamp
  }]

  // Quality Assessment output
  qualityScore, coverage, evidenceQuality

  // Decision Engine output
  verdict: pass | pass_with_issues | fail | regenerate
  confidence, risk
  criticalIssues[], recommendations[]
  improvementPrompt       // structured text for AI Studio regeneration
  stopReason?             // approved | max_iterations | no_improvement | escalated
}
```

### Finding (Evidence)
```
Finding {
  title, severity
  category: bug | missing_feature | workflow_gap

  // Evidence
  observed, expected, impact
  evidence[],            // screenshots, DOM, console refs
  confidence, reproducibility

  // Improvements
  recommendation, fixPrompt

  // Duplicate detection
  isDuplicate, duplicateOf?

  // Workflow context
  isWorkflowGap, journeyPosition?, journeyTotal?
}
```

### Knowledge Pattern
```
KnowledgePattern {
  id
  framework?              // "next.js", "react", "vue"
  authProvider?           // "clerk", "auth0", "firebase"
  pattern                 // "login_timeout_on_safari"
  issue                   // "Clerk SDK times out on Safari 17+"
  recommendation          // "Upgrade to Clerk SDK 5.2+"
  fixPrompt               // structured prompt for regeneration
  source: { missionId, findingId }
  occurrences             // how many missions have seen this
  confidence              // 0-1, increases with occurrences
  firstSeen, lastSeen
}
```

---

## Migration: Pipeline → Capabilities

The existing 7-stage pipeline is wrapped, not rewritten.

### Current Pipeline → Capability Mapping

| Pipeline Stage | Becomes Capability | Status |
|---------------|-------------------|--------|
| workflow_save | Step Capture | ✅ Exists |
| test_generation | Test Generation | ✅ Exists |
| smoke_run | Smoke Test | ✅ Exists |
| schedule_create | Schedule Creation | ✅ Exists |
| dev_intelligence | Root Cause Analysis | ✅ Exists |
| feature_gap | Application Understanding + Feature Gap | 🟡 Exists, needs context+interactive data |
| mission_finalize | Quality Assessment | ✅ Exists, needs separation from Decision |

### Migration Steps

1. Define capability interface (see CAPABILITIES.md)
2. Wrap each pipeline stage as a capability
3. Build orchestrator on top (default: run all, backward compatible)
4. Add Mission Context + Knowledge inputs
5. Gradually replace fixed ordering with dynamic selection

---

## What Already Exists

These are implemented and working today:

- **Agent runtime** (@cleansate/sdk + Playwright + LLM)
- **21 browser/QA tools** (15 browser + 3 QA + 3 planning/interaction)
- **7-stage pipeline** (will be wrapped as capabilities)
- **Session store** with SSE real-time updates
- **Replay engine** with self-healing + visual regression
- **Scheduler** (cron-based regression)
- **Evidence engine** (findings with screenshots, DOM, console)
- **Quality scoring** + improvement prompts
- **Mission layer** with iterations + comparison
- **Public API** + webhooks
- **3-panel dashboard** (runs/chat/viewer)

### What Does NOT Exist Yet

- Orchestrator (currently pipeline drives directly)
- Capability Registry with formal contracts
- Application Understanding (context + interactive + reasoning)
- Knowledge Layer
- Decision Engine (separate from Quality Assessment)
- Evidence Graph (currently flat list of findings)
- Continuous Validation (built but never run live)

---

## Public API Contract

```
POST   /api/v1/missions              → create mission with context, returns mission ID
GET    /api/v1/missions/:id          → status + results
POST   /api/v1/missions/:id/start    → begin validation
POST   /api/v1/missions/:id/stop     → abort
POST   /api/v1/missions/:id/iterate  → trigger next validation run
GET    /api/v1/missions/:id/report   → full report (markdown | json)
GET    /api/v1/missions/:id/comparison → delta between last two iterations
POST   /api/v1/webhooks              → register callback for async results
```

### Input Sources

```
AI Studio:  POST /api/v1/missions { appUrl, buildPrompt, generationId }
Human:      Dashboard URL input → creates session → mission wraps it
CI/CD:      POST /api/v1/missions { appUrl, schedule, testCredentials }
```

---

## Phase 5+ Architecture Refinements (Documented — Not Built Yet)

These are acknowledged improvements for when the system needs to scale. They do NOT
block the current build — they're architecture evolution notes for future engineers.

### 1. Mission / Execution / Result Separation

Currently Mission carries runtime state (iterations, verdict, confidence, recommendations).
Eventually split into:

```
Mission     — what needs to be achieved (context, objectives, constraints) — immutable
Execution   — what happened while doing it (iterations, capabilities run, timings)
Result      — the final outcome (verdict, score, improvement prompt, recommendations)
```

Prevents Mission from becoming a 300-field object over time.

### 2. Event-Driven Capability Execution

Currently capabilities run in a declared dependency order. Eventually evolve toward:

```
Capability finishes → Publish Event → Interested capabilities run
```

Example: "Login failed" event → Knowledge + Security + Workflow + Quality all react.
Much more scalable than fixed ordering. Enables reactive, not just sequential, execution.

### 3. Resource Manager

Separates "what to run" (Orchestrator) from "how to run it efficiently" (Resource Manager).

```
Orchestrator decides → Resource Manager allocates → Capabilities execute
```

Resource Manager owns:
- Browser instance pooling (reuse across missions)
- LLM routing (model selection per capability cost budget)
- Token budget enforcement (per-mission, per-user)
- Worker allocation and concurrency control
- Timeout management
- Queue management

Critical for Thomas's 1M users / 50-100K workers vision. Not needed at current scale.

### 4. Observability Layer

```
Telemetry → Metrics → Logs → Tracing
```

Tracks per-capability: execution time, token usage, browser time, retries, failures.
Essential for debugging production deployments. Minimal version can be structured
logging with run IDs from the start.

### 5. Knowledge Versioning

Current schema is Pattern → Confidence. Add:

```
Pattern → Version → Source → Validated By → Confidence → Valid For (framework version range)
```

Prevents older knowledge from becoming misleading (e.g., a React 18 pattern that
doesn't apply to React 19). Pattern entries become versioned, not just accumulated.

---

## AI Studio Integration Contract

```
Input:  { appUrl, buildPrompt, generationId, objectives, testCredentials? }
Output: {
  verdict: pass | pass_with_issues | fail | regenerate,
  qualityScore: 0-100,
  confidence: 0-1,
  risk: low | medium | high,
  purpose: { id, name, confidence },
  findings: [{ observed, expected, impact, evidence, recommendation, fixPrompt, confidence }],
  workflowGaps: [{ step, context, fixPrompt }],
  improvementPrompt: "...",
  regressionReady: true/false,
  nextSteps: ["Fix X", "Implement Y"]
}
```
