# Refine Engineering Review Experience

## Goal
Refine the existing single-file Engineer Review Workspace into a production-quality engineering review experience without redesigning the layout or removing existing sections. Answer: *"AI Studio finished generating my application. Exactly what should I review before I consider this application production ready?"*

## Changes (all within `/workspace/index.html`)

### 1. Generation Summary (NEW — top of content, before Section 1)
Compact summary card showing:
- "Application Generated Successfully" header with success checkmark
- Application Name, Generation Duration, Review Cards Generated (count)
- Critical Review Items, Warnings counts
- Estimated Engineer Review Time, Estimated AI Fix Time
- "Ready for Engineering Review" badge

### 2. Rename Task → Engineering Review Card
- CSS class rename `.task` → `.review-card` (keep old as alias for compat)
- Labels throughout change from "task" to "review card" / "card"

### 3. Reason for Review (NEW field on every card)
Each card starts with a "Reason for Review" line. Add `reason` to each data item.

### 4. Generated From / Origin badge (NEW field)
Each card displays where it came from: PRD, Generated Code, Architecture, Static Analysis, etc.
Add `origin` to each data item.

### 5. Priority in card header (NEW — promoted from severity)
Colored priority badges: 🔴 Critical, 🟠 High, 🟡 Medium, 🟢 Low.
Add `priority` to each data item (derived from existing severity + context).

### 6. Card structure refinement
Each card: Title, Priority badge, Reason for Review, Origin badge, Status, Description/Expected/Observed, Engineer Notes, Recommendation, Est. Fix Time, Checkbox, Action buttons.

### 7. Replace Copy Prompt → Fix with AI
Remove "Copy Prompt" button text. Replace with: "Fix with AI", "Mark Reviewed", "Mark Complete". Keep the prompt text visible but framed as "AI Fix Prompt".

### 8. Review Progress bar (NEW — above cards)
Shows: total cards, reviewed count, completed count, critical remaining, estimated remaining time.

### 9. Review Order — group by priority
Within each review section, group cards: Critical → High → Medium → Low.
Add sort controls: by Estimated Review Time, Module, Recently Updated.

### 10. Workflow lifecycle visual
Compact horizontal stepper on every card:
Generated → Review → Notes → Request Fix → Fix Generated → Validate → Complete
Active/complete stages highlighted.

### 11. Keep ALL existing sections
Understanding, History, Structure, Features, Functional, Architecture, Code, UI, UX, Bugs, AI Recs, Engineer Checklist, Summary — all remain.

### 12. Design style
Enterprise SaaS: GitHub / Linear / Cursor / Notion aesthetic. Minimal, fast, highly readable.

## Acceptance Criteria
- [ ] Generation Summary appears at top before Section 1
- [ ] Every card has a "Reason for Review" field
- [ ] Every card shows a "Generated From" origin badge
- [ ] Priority badge in card header (colored, 4 levels)
- [ ] "Fix with AI" button replaces "Copy Prompt"
- [ ] Review Progress bar above cards with live counts
- [ ] Cards grouped by priority within each section
- [ ] Sort controls present (review time, module, recently updated)
- [ ] Workflow stepper visual on every card
- [ ] All 13 original sections preserved
- [ ] No console errors
- [ ] Existing interactivity (checklists, filters, search, export, summary) still works
