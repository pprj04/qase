# UI Redesign: AI-First Autonomous Software Quality Engineer

## Constraint

EVOLUTION of existing UI, not a rebuild. Keep: left sidebar, top nav, three-panel layout, live browser panel, dark theme, all existing navigation and modals. Only the Runs page interior changes.

## Changes Overview

### 1. Middle Panel — Replace Pipeline + Dev Intel

**Remove**: `#mission-phases` (3-dot connected phases), `#pipeline-panel` (⚡ Autonomy Pipeline), `#dev-intel-panel` (🧠 Developer Intelligence)

**Add**: 
- `#mission-progress` — vertical timeline with 6 stages: Understand Application, Explore, Validate, Reason, Improve, Complete. Each stage shows status (running/waiting/complete/failed) with animation. NOT boxes-connected-by-lines.
- `#app-understanding` — primary AI card showing: Application Type, Confidence, Detected Features (✓), Expected Features (✓/✗), Business Workflow (vertical flow). This replaces the dev-intel panel.

### 2. Right Panel — Replace Tabs

**Remove**: Activity / Plan / Report tabs

**Add**: Thinking / Evidence / Report tabs
- Thinking tab: AI reasoning stream (uses existing `#thinking-strip` concept, moved to full tab)
- Evidence tab: Console, Screenshots, Network, DOM, Videos sub-sections
- Report tab: Final findings (grouped by severity/category)

### 3. Empty State — AI Workspace

Replace "Autonomous QA Agent" heading with:
- Large heading: "Autonomous Software Quality Engineer"
- Subtitle paragraph
- Large centered input box (existing composer evolved)
- Suggested prompt chips

### 4. Mission Summary (after execution)

Replace the chat header subtitle area with:
- Application name, Quality Score, Release Ready, Confidence, Critical Issues, Feature Gaps, UX Score, Security, Performance

### 5. Findings (in Report tab)

Grouped by: Critical, High, Medium, Low, Feature Gaps, UX, Security, Accessibility, Performance. Each finding shows: Problem, Impact, Evidence, Recommendation, AI Fix Prompt.

## Backward Compatibility

All existing DOM IDs must be preserved — JS depends on them. The new components are rendered INTO existing containers, or existing containers are repurposed with new innerHTML while keeping their IDs.

## Files to Change

- `public/index.html` — restructure Runs page panels
- `public/styles.css` — new CSS for mission progress, app understanding, premium dark theme
- `public/pipeline.js` — rewrite to render mission progress + app understanding
- `public/app.js` — update empty state, tab labels, SSE handling

## Out of Scope

- No new pages
- No navigation changes
- No changes to Tests, Bugs, Workflows, Schedules pages
- No backend changes
- No changes to modals (settings, bug editor, test case editor)
