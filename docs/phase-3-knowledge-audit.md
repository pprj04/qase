# Phase 3 — Knowledge Layer Audit

## 1. Executive Summary

QASE's knowledge layer is **architecturally designed but functionally inert**. The code exists, has 16 passing tests, and is wired into the pipeline — but the knowledge store is empty (`[]`), is never consulted before exploration, never influences agent behavior, has no API endpoints, and has no confidence decay. It is a write-only subsystem whose read path is called too late (post-exploration) to influence anything meaningful.

**Bottom line:** The current knowledge layer cannot make QASE smarter across missions. Phase 3 must transform it into a real reusable intelligence capability.

## 2. Existing Implementation

### 2.1 Storage

| Aspect | Detail |
|---|---|
| File path | `.qase/knowledge.json` |
| Format | JSON array of pattern objects |
| Load | `load()` at import time — synchronous read into module-global `patterns` array |
| Save | `scheduleSave()` — 500ms debounce, uses raw `writeFileSync` (⚠️ NOT atomic) |
| Current state | `[]` (empty — no patterns have ever persisted) |

### 2.2 Knowledge Item Schema (current)

```javascript
{
  id:             "kp_<8char>",
  framework:      string | null,
  authProvider:   string | null,
  appType:        string | null,
  pattern:        string,       // normalized issue text
  issue:          string,       // original finding title
  recommendation: string,
  fixPrompt:      string | null,
  source: {
    missionId:    string,
    findingId:    string | null,
  },
  occurrences:    number,
  confidence:     number,
  firstSeen:      number,       // epoch ms
  lastSeen:       number,       // epoch ms
}
```

**Missing from schema:** category/type, validation status, provenance chain, applicable conditions, decay metadata, related missions/sessions, conflict tracking.

### 2.3 Functions (server/knowledge.js, 278 lines)

| Function | Lines | Purpose |
|---|---|---|
| `detectAppMetadata(session)` | 89-123 | Regex-based framework/auth/appType detection from session text |
| `writeKnowledge(findings, session, missionId)` | 155-213 | Extract patterns from notable findings (severity ≥ medium) |
| `queryKnowledge(metadata)` | 224-251 | Match patterns by OR logic on framework/authProvider/appType |
| `getAllPatterns()` | 255 | Return all patterns |
| `getPatternById(id)` | 259 | Lookup by ID |
| `deletePattern(id)` | 263 | Remove by ID |
| `clearAllPatterns()` | 271 | Wipe everything |

### 2.4 Confidence Model (current)

Pure occurrence-based step function:
- 1 occurrence → 0.30
- 2 → 0.50
- 3 → 0.70
- 5+ → 0.85
- 10+ → 0.95

**No decay, no recency, no validation, no contradiction handling.** Confidence only ever goes up.

### 2.5 Pipeline Integration

- `knowledge_write` capability is pipeline stage 9 (last), runs after `mission_finalize`
- `feature_gap` (stage 7) and `application_understanding` (stage 6) query knowledge, but only store results as metadata — they don't change behavior based on knowledge
- Agent (stage 0 — pre-pipeline) has ZERO knowledge integration

## 3. Critical Gaps Identified

### 🔴 Never Consulted Before Exploration

The #1 gap. The agent runs `buildMissionPrompt()` in index.js with no knowledge lookup. The agent explores blindly every time.

### 🔴 OR-Based Query Matching Bug

`queryKnowledge` matches if ANY of framework/authProvider/appType match independently. A `next.js + clerk` auth bug pattern will match any `next.js` app. The dedup key on write uses conjunction (framework+auth+issue), but query uses disjunction. Semantic mismatch.

### 🔴 Non-Atomic File Writes

`writeFileSync` directly. Every other store (findings.js, store.js, missions.js) uses `atomicWrite.js`. Crash during write corrupts knowledge.json.

### 🔴 No Confidence Decay

Old patterns retain confidence forever. A bug fixed 6 months ago still tests at 0.95.

### 🔴 No Input Sanitization

Finding titles (potentially from web content or LLM) are stored verbatim. Could contain prompt injection vectors when later surfaced.

### 🔴 No API Endpoints

`getAllPatterns`, `getPatternById`, `deletePattern` are exported but never called from any route.

### 🔴 No Conflict Handling

If current evidence contradicts historical knowledge, there's no mechanism to detect, record, or resolve the conflict.

### 🔴 No Validation Tracking

No concept of confirmed/supported/contradicted/not_tested. Every pattern is just accumulated.

### 🔴 No Deduplication Beyond Exact Key

Two findings with slightly different wording but the same semantic meaning create separate patterns.

### 🔴 Unbounded Growth

No eviction, no TTL, no cap. Patterns accumulate forever.

### 🔴 Redundant detectAppMetadata Calls

`appUnderstanding.js` calls `detectAppMetadata` twice (lines 182, 203). Minor waste.

### 🟡 Silent Failure in knowledge_write

`requiredEvidence: []` but code reads `evidence.missionResult`. If mission_finalize fails, knowledge silently skips.

## 4. Data Flow (Current)

```
WRITE PATH (post-mission, pipeline stage 9):
  session.findings → knowledge_write → writeKnowledge()
    → detectAppMetadata(session)
    → for each finding (severity ≥ medium):
        normalize issue → dedup key → create/accumulate
    → scheduleSave() → writeFileSync(.qase/knowledge.json)

READ PATH (post-exploration, pipeline stages 6-7):
  feature_gap → detectAppMetadata → queryKnowledge → stored as metadata (unused)
  appUnderstanding → detectAppMetadata → queryKnowledge → stored as metadata (unused)

MISSING PATH:
  ❌ mission start → queryKnowledge → inject into agent prompt
  ❌ mission end → validate knowledge (confirmed/contradicted)
  ❌ API → getAllPatterns → expose to user
  ❌ conflict detection (current evidence vs historical)
```

## 5. What Phase 3 Must Build

1. **Formal knowledge model** — categories, schema, provenance
2. **Enhanced knowledge store** — atomic writes, deduplication, bounded growth
3. **Multi-factor confidence** — occurrence + recency + validation + consistency - contradiction
4. **Confidence decay** — old unused patterns lose confidence
5. **Relevance matching** — App Model-aware, not just keyword OR-matching
6. **Pre-exploration injection** — knowledge queried and provided to agent as hints
7. **Post-mission validation** — classify each relevant pattern as confirmed/contradicted/not_tested
8. **Conflict detection** — current evidence vs historical knowledge
9. **API endpoints** — retrieve, inspect, manage knowledge
10. **UI section** — minimal knowledge display with provenance
11. **Security** — sanitize all knowledge content, delimit as untrusted in prompts
12. **Test suite** — comprehensive Phase 3 tests
13. **Multi-mission learning validation** — demonstrate real learning loop

## 6. Constraints

- Preserve Phase 1 (299/299 tests) and Phase 2 (75/75 tests) — 374/374 total
- File-based storage (no database migration)
- No architecture redesign
- No new AI capabilities beyond structured knowledge
- Historical knowledge never overrides current evidence
- Simplest scalable mechanism compatible with current project
