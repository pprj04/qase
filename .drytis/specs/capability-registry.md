# C1: Capability Registry + Orchestrator

## Problem

`pipeline.js` is a hardcoded linear function with cascading early-returns. Adding/removing/reordering stages requires editing the monolithic function. There's no formal contract for what each stage needs or produces, and no way to reason about dependencies programmatically.

## Goal

Wrap the existing pipeline as a Capability Registry + Orchestrator — an evolutionary migration where pipeline stages become registered capabilities with formal contracts. **Behavior is unchanged.** The existing pipeline code runs exactly as before, but through the Orchestrator's planning and dependency resolution.

## Design

### `server/capabilities.js` — new module

```js
// Capability interface
{
  id: string,                    // 'workflow_save', 'test_generation', etc.
  name: string,                  // human-readable
  category: string,              // 'extraction', 'generation', 'validation', 'analysis'
  
  // Dependencies
  dependsOn: string[],           // capability ids that must complete first
  requiredEvidence: string[],    // evidence keys this capability needs (e.g. 'workflow', 'testCases')
  producesEvidence: string[],    // evidence keys this capability provides
  
  // Contract
  enabled: (config, evidence) => boolean,
  execute: async (session, evidence, config) => result,
  
  // Metadata
  confidence: number,            // base confidence in this capability's output (0-1)
  cost: 'low' | 'medium' | 'high'  // relative cost
}
```

### Orchestrator

```js
class Orchestrator {
  register(capability)
  plan(evidence)         // topological sort by dependencies, filter enabled
  execute(session, config)  // run in dependency order, collect evidence
}
```

The Orchestrator:
1. Topologically sorts capabilities by `dependsOn`
2. Filters to enabled ones (based on config + available evidence)
3. Executes in order, collecting results and building an evidence object
4. If a dependency fails, downstream capabilities that require its evidence are skipped (same behavior as the current early-return cascades)

### Existing pipeline stages → capabilities

| Stage | Capability id | dependsOn | producesEvidence |
|-------|-------------|-----------|-----------------|
| 1 | workflow_save | [] | workflow |
| 2 | test_generation | [workflow_save] | testCases |
| 3 | smoke_run | [test_generation] | smokeResults |
| 4 | schedule_create | [test_generation] | schedule |
| 5 | dev_intelligence | [] | devReport |
| 6 | feature_gap | [] | featureGaps |
| 7 | mission_finalize | [feature_gap] | missionResult |
| 8 | knowledge_write | [mission_finalize] | knowledgePatterns |

Note: dev_intelligence and feature_gap have NO hard dependencies — they could run in parallel in the future. But for now, the Orchestrator runs sequentially to preserve exact behavior.

### Migration path

1. Create `capabilities.js` with registry + orchestrator
2. Register all 8 stages as capabilities, wrapping the EXISTING logic from pipeline.js
3. Replace `runAutonomyPipeline` body with `orchestrator.execute(session, config)`
4. Keep all SSE events, error handling, and result shapes identical

## Acceptance Criteria

- [ ] CapabilityRegistry can register and list capabilities
- [ ] Orchestrator plans execution order via topological sort
- [ ] Orchestrator skips capabilities whose dependencies failed
- [ ] Orchestrator skips disabled capabilities (based on config)
- [ ] All 8 existing pipeline stages registered as capabilities
- [ ] Orchestrator output matches existing pipeline output (same result shape, same SSE events)
- [ ] Evidence object accumulates across capability execution
- [ ] Knowledge query runs before feature_gap (via dependsOn or explicit ordering)
- [ ] Knowledge write runs after mission_finalize
- [ ] Failed capability marks downstream deps as skipped (not failed)
- [ ] Unit tests cover: registration, planning, execution, dependency skip, disabled skip, evidence accumulation

## Tests

File: `tests/test-capability-registry.js`

Test cases:
1. Registry registers and lists capabilities
2. Registry rejects duplicate capability ids
3. Orchestrator plans correct order based on dependencies
4. Orchestrator skips capabilities when dependency produced no evidence
5. Orchestrator skips disabled capabilities
6. Orchestrator executes capabilities and collects evidence
7. Failed capability marks downstream as skipped
8. Full pipeline equivalence: orchestrator produces same stages as direct pipeline call

## Out of Scope

- Parallel execution (sequential only for now)
- Dynamic capability addition at runtime
- Confidence-based stopping criteria
- Resource Manager (browser pools, LLM budget)
- Event-driven execution
