# Phase 3 — Knowledge Architecture / Learning Layer Spec

## Task
Transform QASE's knowledge layer from a write-only data dump into a real reusable intelligence capability that learns from past missions and guides future exploration.

## Acceptance Criteria

### Knowledge Model
- [ ] AC1: Formal knowledge model exists with categories (application, functional, quality, testing, environmental)
- [ ] AC2: Every knowledge item has provenance (sourceMissions with missionId, findingId, timestamp)
- [ ] AC3: Knowledge schema includes: id, type/category, pattern, description, framework, authProvider, appType, confidence, occurrences, firstSeen, lastSeen, validation status, applicable conditions

### Confidence
- [ ] AC4: Multi-factor confidence (occurrence + recency + validation + consistency)
- [ ] AC5: Confidence decay over time (90-day half-life, floor 0.3)
- [ ] AC6: Contradicted patterns lose confidence faster than confirmed patterns gain it

### Deduplication & Aggregation
- [ ] AC7: Similar findings are deduplicated (Jaccard similarity ≥ 0.65 + metadata match)
- [ ] AC8: Cross-mission aggregation (occurrences + sourceMissions accumulate)
- [ ] AC9: Bounded growth (max 500 patterns, LRU eviction)

### Relevance & Query
- [ ] AC10: App Model-aware relevance matching (not just OR-based keyword)
- [ ] AC11: Knowledge query returns structured hints with relevance score and reason

### Pre-Exploration Injection
- [ ] AC12: Knowledge queried BEFORE exploration at mission start
- [ ] AC13: Hints injected as UNTRUSTED guidance, clearly delimited
- [ ] AC14: Hints guide WHERE to look, never dictate WHAT IS TRUE

### Validation
- [ ] AC15: Post-mission validation classifies patterns: confirmed/supported/contradicted/not_tested/irrelevant
- [ ] AC16: NOT_TESTED is distinct from failure (neutral confidence impact)
- [ ] AC17: Contradictions decrease confidence

### Conflict Handling
- [ ] AC18: Current evidence always outranks historical knowledge
- [ ] AC19: Conflicts detected and exposed (resolution: current_evidence_wins)

### Security
- [ ] AC20: Prompt injection defense (sanitizeText strips 8+ patterns)
- [ ] AC21: Knowledge content treated as untrusted data
- [ ] AC22: No XSS, no instruction propagation

### Integration
- [ ] AC23: knowledge_write capability enhanced with validation + conflict detection
- [ ] AC24: API endpoints exist (7 endpoints)
- [ ] AC25: UI shows knowledge section (hints, validation, conflicts)

### Quality Gates
- [ ] AC26: 5+ mission scenarios validate learning loop
- [ ] AC27: Full regression suite passes (459/459)
- [ ] AC28: Phase 2 tests remain green (75/75)
- [ ] AC29: Performance measured
- [ ] AC30: Documentation complete (3 docs)
- [ ] AC31: No Phase 4 work started

## Key Constraints
- Historical knowledge NEVER overrides current evidence
- No vector database, no MySQL migration
- No architecture redesign, no Phase 4 features
- Preserve Phase 1 (299/299) and Phase 2 (75/75) baselines
