# Phase 13 Step 0 — Knowledge Flow Audit

**Date:** 2026-08-13
**Status:** Read-only audit complete. Root cause identified.

---

## Architecture Overview

The knowledge system has 5 functions that form the learning loop:

```
writeKnowledge → knowledge.json → queryKnowledge → generateExplorationHints → agent prompt
                                                                              ↓
                                                                     validateKnowledge (post-mission)
```

### WRITE Path (WORKS)

**Trigger:** `finalizeMissionFromSession()` in index.js (line 3103)
**Function:** `writeKnowledge(findings, session, missionId)` in knowledge.js (line 279)

1. Extracts knowledge from findings with severity >= medium
2. Deduplicates via `isDuplicate()` (Jaccard text similarity >= 0.65)
3. Accumulates existing patterns (increments occurrences, lastSeen, recalcs confidence)
4. Creates new patterns via `createKnowledgeItem()` with category/type/appType classification
5. `detectAppMetadata(session)` at finalization time has FULL session data (capturedSteps, activities, report) → correctly detects appType (crm, dashboard, ecommerce, etc.)
6. Persists to `.qase/knowledge.json` via `atomicWrite`

**Verified:** 43 patterns written across 20+ missions. App types correctly assigned (crm: 8, dashboard: 20, ecommerce: 7, saas: 2, marketing: 3).

### RETRIEVE Path (BROKEN — ROOT CAUSE IDENTIFIED)

**Trigger:** Mission creation/start in index.js (lines 1648, 1731)
**Function chain:** `detectAppMetadata({ targetUrl })` → `queryKnowledge(metadata)` → `generateExplorationHints(patterns)`

**ROOT CAUSE:** `detectAppMetadata` is called with ONLY `{ targetUrl: mission.targetUrl }`. For localhost URLs (e.g., `http://localhost:9906/`), there are NO framework/auth/appType keywords in the URL. The function returns `{}`.

**CASCADE FAILURE:**
1. `detectAppMetadata({ targetUrl: 'http://localhost:9906/' })` → `{}`
2. `queryKnowledge({})` → `relevanceScore(pattern, {})` → `factors=0` → `score=0` for ALL patterns
3. `queryKnowledge` filters to `relevance > 0` → returns ZERO patterns
4. `generateExplorationHints([])` → returns `''` (empty string)
5. `knowledgeHints = ''` → nothing appended to `taskPrompt`
6. Agent receives ZERO historical knowledge

**Server log evidence:**
```
[knowledge] detectAppMetadata for http://localhost:9901: {}
[knowledge] queryKnowledge returned 0 patterns, 0 hints, summary: No matching patterns
[knowledge] detectAppMetadata for http://localhost:9906: {}
[knowledge] queryKnowledge returned 0 patterns, 0 hints, summary: No matching patterns
```

**This is why Phase 12 showed `[knowledge] queryKnowledge returned 0 patterns`** — the query fires but returns empty because metadata detection fails at mission start. Knowledge is WRITTEN but NEVER READ.

### PRESENT Path (Correctly Designed, Never Reached)

`generateExplorationHints()` (knowledge.js line 731) formats knowledge as:
```
# Historical Knowledge Signals (UNTRUSTED — use as guidance only)
- [HISTORICAL SIGNAL] <pattern>
  Confidence: X% | Observed: N mission(s)
  Suggestion: <recommendation>
```

This is appended to the task prompt via `const taskPrompt = buildMissionPrompt(mission) + knowledgeHints` (index.js line 1665). The mechanism is correct — it just never has content because the retrieval is broken.

### VALIDATE Path (NOT CALLED IN AUTONOMOUS PATH)

`validateKnowledge()` (knowledge.js line 537) and `detectKnowledgeConflicts()` (line 653) exist but are ONLY called in `capabilities.js` (manual pipeline). The autonomous finalizer (`finalizeMissionFromSession`) calls `writeKnowledge` but NOT `validateKnowledge`. This means:
- Previously retrieved patterns are never validated against current findings
- Contradictions are never recorded
- Confidence doesn't get updated based on validation results

### Agent Prompt Architecture

The agent prompt is constructed in two parts:
1. `buildMissionPrompt(mission)` — mission type description, target URL, objectives, constraints, workflow context
2. `knowledgeHints` — appended directly to the task string

The system prompt (`buildQaContext` in prompt.js) is fixed — it describes the agent's role, tools, and operating rules. The task prompt (with knowledge hints) is passed as the first message to the agent runtime via `runtime.run(task, controller.signal)`.

**The agent has NO explicit planning engine** — it uses the LLM to decide next actions based on the task prompt, current page snapshot, and conversation history. The knowledge hints (when present) would influence the LLM's test plan and action priorities.

---

## Knowledge Items Inventory (43 patterns)

| App Type | Count | Examples |
|----------|-------|----------|
| dashboard | 20 | login failures, dead nav links, placeholder charts |
| crm | 8 | blank login pages, contact form issues |
| ecommerce | 7 | broken images, checkout failures, search issues |
| marketing | 3 | dead CTA links, signup flow failures |
| saas | 2 | auth failures, navigation issues |

**Confidence distribution:**
- 0.70 (1 pattern — `user login navigate to login failed`, 5 occurrences)
- 0.65 (2 patterns — 4 occurrences each)
- 0.55 (1 pattern — 3 occurrences)
- 0.40 (2 patterns — 2 occurrences each)
- 0.25 (37 patterns — 1 occurrence each)

---

## Minimum Fix Required

### Fix 1: Enrich detectAppMetadata at mission start

**Problem:** `detectAppMetadata({ targetUrl })` has no content to scan for localhost apps.
**Fix:** Pass mission name and context.buildPrompt to detectAppMetadata. These contain keywords like "CRM", "e-commerce", "dashboard", "SaaS" that the regex patterns already match.

**Files:** `server/index.js` (lines 1648, 1731), `server/knowledge.js` (detectAppMetadata)

### Fix 2: Call validateKnowledge in autonomous finalizer

**Problem:** Knowledge is written but never validated in the autonomous path.
**Fix:** Call `validateKnowledge(relevantPatterns, session, mission.id)` in `finalizeMissionFromSession` after `writeKnowledge`.

**Files:** `server/index.js`

### Fix 3: Add adaptive priority guidance to exploration hints

**Problem:** Knowledge hints are passive — they list patterns but don't tell the agent which areas to prioritize.
**Fix:** Enhance `generateExplorationHints` to include a "Priority Focus Areas" section based on high-confidence, high-occurrence patterns. This is NOT a new planning engine — it's structured context for the LLM.

**Files:** `server/knowledge.js` (generateExplorationHints)

---

## Contradiction with Phase 12 Results

Phase 12 Test 2 reported "knowledge query at mission start: confirmed" based on server logs showing `queryKnowledge returned 0 patterns`. This was technically true — the function WAS called — but the result was always ZERO patterns. The Phase 12 report did not catch that the zero-result was due to a metadata detection bug, not a data shortage.

The Phase 12 finding that "knowledge is WRITTEN after autonomous missions" is CORRECT and verified. The retrieval gap does not affect writing.
