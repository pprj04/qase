# Phase 3 — Knowledge Architecture

## 1. Overview

Phase 3 transforms QASE's knowledge layer from a write-only data dump into a real reusable intelligence capability. The system can now learn from past missions, surface relevant knowledge before exploration, validate patterns after missions, and handle conflicts between historical knowledge and current evidence.

**Core principle: Historical knowledge is evidence/hints, NOT ground truth. Current evidence determines truth.**

```
Previous Missions
      ↓
Validated Patterns / Knowledge
      ↓
Application Understanding
      ↓
Agent Exploration Strategy    ← Knowledge guides WHERE to look
      ↓                           Never dictates WHAT IS TRUE
Better Testing
      ↓
New Evidence
      ↓
Validated Knowledge
      ↓
Knowledge improves over time
```

## 2. Knowledge Schema

Every knowledge item contains:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ID (`kp_<8char>`) |
| `category` | enum | `application`, `functional`, `quality`, `testing`, `environmental` |
| `type` | string | Sub-type within category (e.g. `auth_flow`, `checkout_flow`, `defect`) |
| `pattern` | string | Normalized pattern description (sanitized, max 200 chars) |
| `description` | string | Original finding title (sanitized, max 500 chars) |
| `recommendation` | string | Testing recommendation (sanitized, max 500 chars) |
| `framework` | string\|null | Detected framework (`next.js`, `react`, `vue`, etc.) |
| `authProvider` | string\|null | Detected auth provider (`clerk`, `auth0`, `supabase`, etc.) |
| `appType` | string\|null | Detected app type (`ecommerce`, `saas`, `crm`, etc.) |
| `applicableConditions` | string[] | Conditions under which this pattern applies |
| `occurrences` | number | Number of independent observations |
| `confidence` | number | Multi-factor confidence (0.01–0.99) |
| `firstSeen` | number | Epoch ms of first observation |
| `lastSeen` | number | Epoch ms of most recent observation |
| `lastValidated` | number\|null | Epoch ms of last validation |
| `status` | enum | `active`, `inactive`, `contradicted` |
| `sourceMissions` | array | Full provenance: `[{ missionId, findingId, sessionId, timestamp }]` |
| `validations` | array | Validation history: `[{ result, missionId, timestamp, detail }]` |
| `contradictions` | array | Contradiction records: `[{ missionId, timestamp, evidence }]` |

### Categories

| Category | Types | Description |
|----------|-------|-------------|
| `application` | framework, auth_provider, app_type, architecture | Technology stack patterns |
| `functional` | auth_flow, registration_flow, checkout_flow, search_flow, crud, onboarding, navigation | User workflow patterns |
| `quality` | defect, ux_issue, accessibility_issue, security_issue, workflow_failure, performance_issue | Quality issue patterns |
| `testing` | high_risk_area, commonly_missed, untested_workflow, edge_case | Testing strategy patterns |
| `environmental` | browser_specific, viewport_specific, network_issue | Environmental patterns |

## 3. Confidence Model

Multi-factor confidence replaces the Phase 1 occurrence-only step function:

```
confidence = clamp(0.01, 0.99,
    occurrenceBase(occurrences)     // Step function: 1→0.25, 2→0.40, 3→0.55, 5→0.70, 10+→0.85
  × recencyFactor(lastSeen)         // Decay: 1.0 fresh → 0.3 after years
  × consistencyFactor(validations)  // Ratio of confirmations to total: [0.5, 1.0]
  + validationBonus(validations)    // +0.05 per confirmation, -0.10 per contradiction (bounded ±0.15/+0.30)
)
```

### Confidence Decay

- Half-life: 90 days
- Formula: `0.3 + 0.7 × 0.5^(age / halfLife)`
- Floor: 0.3 (very old knowledge doesn't vanish completely)
- Applied via `recalculateConfidence()` on every query and periodic `applyDecay()`

### Deactivation Rules

A pattern is deactivated (`status → contradicted`) when:
- Confidence drops below 0.10
- AND it has been contradicted at least 2 times

## 4. Relevance Matching

Knowledge matching is App Model-aware, not just OR-based keyword matching:

| Factor | Weight | Logic |
|--------|--------|-------|
| Framework match | 0.30 | Pattern framework == query framework |
| Auth provider match | 0.30 | Pattern authProvider == query authProvider |
| App type match | 0.20 | Pattern appType == query appType |
| Purpose match | 0.10 | Purpose → appType mapping |
| Feature overlap | 0.10 | Keyword overlap with app model features |

Patterns are sorted by `relevance × confidence` — the most useful patterns surface first.

## 5. Knowledge Lifecycle

### Write Path (Post-Mission)

1. Mission completes → pipeline stage `knowledge_write` executes
2. Findings (severity ≥ medium) are extracted as patterns
3. Each finding is checked for deduplication (Jaccard similarity ≥ 0.65 + metadata match)
4. Existing patterns are accumulated; new ones created
5. Patterns that were surfaced before the mission are validated
6. Conflicts between historical knowledge and current evidence are detected
7. Knowledge is persisted via atomic write

### Read Path (Pre-Exploration)

1. Mission starts → `POST /api/v1/missions/:id/start`
2. App metadata detected from target URL + mission context
3. Knowledge queried: `queryKnowledge(appMeta)`
4. Relevant patterns surface as hints: `generateExplorationHints(patterns)`
5. Hints appended to agent task prompt as UNTRUSTED guidance
6. Agent receives hints as "consider validating this area" — never as facts
7. Pattern IDs stored on session for post-mission validation

### Validation Path (Post-Mission)

After exploration, each pattern that was surfaced gets classified:

| Result | Meaning | Confidence Impact |
|--------|---------|-------------------|
| CONFIRMED | Same issue reproduced | +0.05 |
| SUPPORTED | Related evidence found | +0.03 |
| CONTRADICTED | Evidence shows pattern no longer holds | -0.10 |
| NOT_TESTED | Pattern area was not reached | Neutral |
| IRRELEVANT | Pattern doesn't apply | Neutral |

**NOT_TESTED is never treated as failure.** An unreached pattern area is not evidence that the pattern is false.

## 6. Conflict Handling

When current evidence contradicts historical knowledge:

1. **Detection**: `detectKnowledgeConflicts()` checks if:
   - App Model shows a feature as verified when knowledge says it's broken
   - A finding directly contradicts the pattern's claim
2. **Resolution**: Always `current_evidence_wins`
3. **Impact**: Pattern confidence decreases via contradiction validation
4. **Exposure**: Conflict surfaced in pipeline summary and UI

## 7. Pre-Exploration Injection

The most critical Phase 3 change. Knowledge is now queried BEFORE exploration:

```javascript
// In index.js POST /api/v1/missions/:id/start:
const appMeta = detectAppMetadata({ targetUrl: mission.targetUrl });
const knowledgeResult = queryKnowledge(appMeta);
const hints = generateExplorationHints(knowledgeResult.patterns);
const taskPrompt = buildMissionPrompt(mission) + hints;
```

Hints are formatted as:
```
# Historical Knowledge Signals (UNTRUSTED — use as guidance only)

The following patterns were observed in PREVIOUS missions on SIMILAR applications.
These are historical hints, NOT current facts. Validate everything independently.
Current evidence always overrides historical knowledge.

- [HISTORICAL SIGNAL] Clerk authentication redirect fails
  Confidence: 70% | Observed: 3 mission(s)
  Suggestion: Upgrade Clerk SDK

Remember: Validate these areas but do not assume the pattern holds.
```

## 8. Security

### Prompt Injection Defense

All knowledge content is sanitized before storage and before injection into prompts:

| Pattern Stripped | Reason |
|------------------|--------|
| `ignore previous instructions` | Instruction override |
| `you are now...` | Role hijack |
| `system:`, `assistant:`, `role:` | Role injection |
| `<script>`, HTML tags | XSS |
| `javascript:`, `data:text/html` | Dangerous URLs |

### Untrusted Data Delimitation

Hints are clearly delimited as untrusted historical evidence:
- Section header marks content as "UNTRUSTED"
- Text explicitly states "NOT current facts"
- Text instructs "Current evidence always overrides"
- Patterns marked as "[HISTORICAL SIGNAL]"

## 9. Performance

| Metric | Value |
|--------|-------|
| Query with 200 patterns | < 50ms |
| Write 50 findings | < 100ms |
| Storage | JSON file (`.qase/knowledge.json`) |
| Max patterns | 500 (bounded growth with LRU eviction) |
| Dedup check | O(n) per finding (Jaccard similarity) |
| Atomic writes | Yes (via `atomicWrite.js`) |

## 10. API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/knowledge` | GET | List all patterns + stats |
| `/api/knowledge/:id` | GET | Get pattern with full provenance |
| `/api/knowledge-stats` | GET | Get statistics |
| `/api/missions/:id/knowledge` | GET | Patterns for a specific mission |
| `/api/sessions/:id/knowledge` | GET | Hints injected + validation results |
| `/api/knowledge/:id` | DELETE | Delete a pattern |
| `/api/knowledge/decay` | POST | Apply confidence decay |

## 11. Data Flow

```
                    ┌──────────────────────────────────────────────────┐
                    │              MISSION START                        │
                    │                                                  │
                    │  detectAppMetadata(targetUrl)                    │
                    │       ↓                                          │
                    │  queryKnowledge(appMeta)                         │
                    │       ↓                                          │
                    │  generateExplorationHints(patterns)               │
                    │       ↓                                          │
                    │  taskPrompt = buildMissionPrompt() + hints       │
                    │       ↓                                          │
                    │  Agent explores with knowledge hints             │
                    │  (hints guide WHERE, never WHAT IS TRUE)         │
                    └──────────────────────┬───────────────────────────┘
                                           │
                                           ▼
                    ┌──────────────────────────────────────────────────┐
                    │            MISSION COMPLETE                       │
                    │                                                  │
                    │  Pipeline stage: knowledge_write                  │
                    │       ↓                                          │
                    │  validateKnowledge(patternsUsed, session)         │
                    │    → confirmed / supported / contradicted /       │
                    │      not_tested / irrelevant                      │
                    │       ↓                                          │
                    │  detectKnowledgeConflicts(patterns, appModel)     │
                    │    → current_evidence_wins                        │
                    │       ↓                                          │
                    │  writeKnowledge(findings, session, missionId)     │
                    │    → dedup → accumulate/create                    │
                    │       ↓                                          │
                    │  recalculateConfidence(all patterns)              │
                    │    → apply decay + validation factors             │
                    │       ↓                                          │
                    │  atomicWrite(.qase/knowledge.json)                │
                    └──────────────────────────────────────────────────┘
```

## 12. Limitations & Future Migration

- **File-based storage**: JSON file with bounded size (max 500 patterns). For production scale, migrate to SQLite or PostgreSQL.
- **Linear dedup search**: O(n) per finding. At 500 patterns this is fast (<50ms); at 50k+ patterns, add an index.
- **No vector similarity**: Uses Jaccard token overlap (adequate for short texts). For semantic matching, add embeddings.
- **No multi-tenant isolation**: All knowledge in one store. For multi-tenant, scope by workspace/project.

## 13. Non-Goals (Explicitly Excluded)

- No vector database (unnecessary for current scale)
- No MySQL migration (file-based storage is sufficient)
- No continuous knowledge regeneration
- No knowledge-driven decision engine
- No multi-agent knowledge sharing
- No enterprise RBAC on knowledge
