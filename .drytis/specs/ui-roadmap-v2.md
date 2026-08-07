# Spec: QASE UI Roadmap v2.0 — UX Transformation

> **Vision:** An Autonomous Software Quality Engineer, not a QA Dashboard.
> Separated from backend roadmap — this is about how users experience existing intelligence.

## Status Assessment

### Already Done (from previous round):
- Phase 0: Conversation flex priority, compact panels (80px/120px max-height), collapsible
- Phase 1: Pipeline events inject agent messages into transcript (STAGE_MESSAGES)
- Phase 2: JetBrains Mono, GitHub Dark palette, flat surfaces, 3px radius, no glassmorphism, model badge removed
- Phase 5: MISSION_STATUS label, [ OK ] / [ RUNNING ] / [ FAIL ] indicators

### Gaps to Fill (this round):

## Phase 0 Gap — Default Collapsed After Complete
- [ ] Mission Status and Application Analysis default to collapsed state when pipeline completes
- [ ] User can expand if curious, but conversation stays primary

## Phase 1 Gap — Full AI Workspace Flow
- [ ] Findings appear progressively in conversation (not just stage completions)
- [ ] Recommendations generated naturally at end of mission
- [ ] Streaming agent messages feel like Claude reasoning

## Phase 3 — Live Mission Experience
- [ ] Mission status shows live progress with animated [ RUNNING ] indicators
- [ ] Progressive evidence updates in EVIDENCE tab
- [ ] Agent messages update in real-time as each step completes
- [ ] Mission timeline shows "Exploring → Testing → Reasoning → Recommendation" flow

## Phase 4 — Compact Application Understanding Inspector
- [ ] Replace large card with compact expandable section
- [ ] Collapsed: `APPLICATION: CRM | 91% confidence ▾`
- [ ] Expanded: shows detected features (✓), missing features (✗), workflow steps
- [ ] One-line collapsed summary always visible

## Phase 6 — Findings Grouped by Intelligence
- [ ] Findings grouped: Critical, Feature Gaps, UX, Security, Accessibility, Performance
- [ ] Each finding: problem, impact, evidence, recommendation, AI fix prompt
- [ ] Appears in conversation + report tab

## Phase 8 — Release Assessment
- [ ] End every mission with release decision block
- [ ] Shows: status (NOT READY / READY), confidence, quality score, critical issues, gaps
- [ ] Recommended next action with revalidate option

## Implementation Order
1. Phase 0 gap: default collapsed
2. Phase 4: compact inspector redesign
3. Phase 1+3: enhanced conversation flow + live experience
4. Phase 6: grouped findings
5. Phase 8: release assessment

## Files
| File | Phases |
|------|--------|
| public/styles.css | 0, 4 (compact inspector styling) |
| public/index.html | 4, 8 (inspector structure, release block) |
| public/pipeline.js | 0, 4, 5 (collapsed default, compact rendering) |
| public/app.js | 1, 3, 6, 8 (conversation flow, findings, release) |

## Acceptance Criteria
- [ ] Panels default collapsed after pipeline complete
- [ ] Application Understanding is a one-line inspector that expands on click
- [ ] Conversation shows progressive findings and recommendations
- [ ] Mission status shows live [ RUNNING ] → [ OK ] transitions
- [ ] Findings grouped by category in report
- [ ] Release assessment block at end of mission
- [ ] Zero console errors
- [ ] All backend tests pass
