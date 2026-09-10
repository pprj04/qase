# Architecture Revision — August 7, 2026

## What Changed

A review (8/10) fundamentally reframed the architecture from pipeline-first
to capability-driven, with a Knowledge Layer as the critical missing concept.

## Key Decisions Accepted

1. **Capabilities, not percentages** — Measure capability status (Understand,
   Validate, Improve, Learn, Close Loop) instead of component percentages.

2. **AI Studio is an Input Source, not an Integration** — AI Studio creates
   Missions, same as humans or CI/CD. Mission owns everything.

3. **Application Understanding is the bottleneck, not Interactive Exploration**
   — Interactive exploration is ONE input. Understanding = Context + Static +
   Interactive + Reasoning.

4. **Purpose emerges from understanding** — Not inferred first from crawl data.

5. **Knowledge Layer is the biggest missing concept** — Every mission starts
   from zero today. Pattern store + read/write across missions is essential.

6. **Pipeline → Capability Architecture** — Orchestrator + Capability Registry
   replaces fixed 7-stage pipeline. Evolutionary migration, not rewrite.

7. **Engineering effort is estimable** — ~12 weeks for Phases 1-4. Research
   outcomes (will accuracy reach 90%?) are measured, not predicted.

## What Was Adjusted

- Knowledge Layer starts minimal (pattern store + simple matching), not as
  a full framework rules engine
- Migration is evolutionary: pipeline stages become capabilities, orchestrator
  wraps existing pipeline first
- UI redesign can happen in parallel with capability work

## Documents Updated

- /workspace/.drytis/MISSION.md — Complete rewrite with capability architecture
- /workspace/.drytis/ROADMAP.md — Revised with capability-driven phases
- /workspace/.drytis/specs/next-workflow-plan.md — Updated workstreams

## Engineering Estimates

| Task | Effort |
|------|--------|
| Mission Context Input | ~1 week |
| Knowledge Layer Phase 1 | ~1 week |
| Interactive Exploration Bridge | ~2 weeks |
| Orchestrator (pipeline wrapper) | ~1 week |
| SPA Route Detection | ~1 week |
| AI Studio Contract | ~1 week |
| Real App Validation | ~2 weeks |
| UI Redesign | ~1 week |
| Capability Migration | ~2 weeks |
| **Total** | **~12 weeks** |
