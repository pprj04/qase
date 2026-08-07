# Task: Knowledge Layer Phase 1 (A2)

## Objective

Build the minimal Knowledge Layer: a pattern store that lets Qase learn from past
missions and apply that knowledge to future ones. Write after each mission,
read before each mission.

## Files to Create/Change

- `server/knowledge.js` — NEW: PatternStore class with CRUD, match, accumulate
- `server/pipeline.js` — Hook knowledge_write into pipeline after mission_finalize
- `server/missions.js` — Add knowledge query on mission start
- `tests/test-knowledge.js` — New test file

## Acceptance Criteria

- [ ] `server/knowledge.js` exists with PatternStore class
- [ ] PatternStore.create(pattern) — stores a new knowledge pattern
- [ ] PatternStore.match(metadata) — queries patterns by framework/authProvider/appType
- [ ] PatternStore.accumulate(patternId) — increments occurrences, updates confidence + lastSeen
- [ ] PatternStore.getAll() — returns all patterns (for debug/API)
- [ ] After mission_finalize: findings with severity >= medium are extracted as patterns
- [ ] Before exploration: app metadata is matched against knowledge base
- [ ] Matched patterns surface in the report under "Known Patterns Detected"
- [ ] Pattern confidence model: 1=0.3, 2=0.5, 3=0.7, 5=0.85, 10+=0.95
- [ ] Knowledge query returns capability hints (e.g., "deepen auth testing")
- [ ] Persistence to `.qase/knowledge.json`
- [ ] Unit tests cover: create, match, accumulate, query, confidence model

## Test Plan

```
1. Create pattern: { framework: "next.js", pattern: "login_timeout", issue: "..." }
   → confidence = 0.3 (first occurrence)

2. accumulate(patternId) twice
   → occurrences = 3, confidence = 0.7

3. match({ framework: "next.js" }) → returns the pattern
4. match({ framework: "react" }) → returns [] (no match)

5. Pattern from Mission A surfaces in Mission B when frameworks match
```

## Schema

```json
{
  "id": "kp_001",
  "framework": "next.js",
  "authProvider": "clerk",
  "pattern": "login_timeout_safari",
  "issue": "Clerk SDK times out on Safari 17+",
  "recommendation": "Upgrade to Clerk SDK 5.2+",
  "fixPrompt": "Update Clerk SDK...",
  "source": { "missionId": "...", "findingId": "..." },
  "occurrences": 3,
  "confidence": 0.7,
  "firstSeen": "2026-08-07T...",
  "lastSeen": "2026-08-07T..."
}
```
