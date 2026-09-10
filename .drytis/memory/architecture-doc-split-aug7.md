# Architecture Document Split — August 7, 2026

## What Changed

After a 9.5/10 review of MISSION.md, the architecture documents were split
into 5 focused files per reviewer recommendation:

1. **MISSION.md** (96 lines) — Vision, principles, product definition only.
   "What Qase is" — no architecture or roadmap details.

2. **ARCHITECTURE.md** (358 lines) — System diagram, orchestrator design,
   capability dependency graph, evidence pipeline (3 layers: Raw → Normalized → Graph),
   data model, migration strategy, public API contract.

3. **ROADMAP.md** (146 lines) — Phases organized by capability milestones
   (not implementation tasks). Success metrics table. Engineering estimates
   separated from research risk.

4. **CAPABILITIES.md** (414 lines) — Formal contract for every capability
   in the registry. Each declares: id, name, inputs, outputs, dependencies,
   requiredEvidence, producesEvidence, confidence, cost. 11 capabilities
   defined. Dependency graph included.

5. **KNOWLEDGE.md** (138 lines) — Pattern store schema, write/read logic,
   confidence model, how knowledge influences planning, Phase 2 roadmap.

## Key Architecture Decisions in This Revision

1. **Orchestrator is a mission manager** — owns planning, scheduling,
   dependency resolution, retries, confidence evaluation, stopping criteria.
   Not just a dispatcher.

2. **Capability contracts are formal** — each capability declares inputs,
   outputs, dependencies, confidence, cost. Independently testable.

3. **Evidence is 3-layered** — Raw (screenshots, DOM, console) →
   Normalized ("Login failed", "Missing button") → Evidence Graph
   (relationships between findings).

4. **Quality Assessment ≠ Decision Engine** — Assessment determines what
   happened (score, coverage, evidence quality). Decision determines what
   to do (approve, regenerate, escalate, stop). Business policy separated
   from analysis.

5. **Knowledge actively influences planning** — not just read for reports.
   "Clerk auth detected → deepen auth testing" changes capability selection.

6. **Roadmap organized by milestones** — "Application Understanding"
   milestone complete when purpose accuracy is measured, not when code
   is written.

## Document Index

```
.drytis/
├── MISSION.md          — Vision + principles
├── ARCHITECTURE.md     — System design + data model
├── ROADMAP.md          — Phases + milestones + metrics
├── CAPABILITIES.md     — Capability contracts
├── KNOWLEDGE.md        — Knowledge layer design
└── specs/
    └── next-workflow-plan.md — Concrete workstreams with Definitions of Done
```
