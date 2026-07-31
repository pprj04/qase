# Kanban AI Engineering Task Board

## Goal
Replace the scrollable review workspace with a production-grade Kanban board (Jira/Linear/Trello style) for AI-generated engineering tasks. After AI Studio generates an app, the AI analyzes it and creates structured work items on a draggable board.

## Layout
- **Left**: breadcrumb nav
- **Top header**: app name, "Generation Completed", task counts (total/critical/review time/fix time), overall progress ring, action buttons (Generate More Tasks, Refresh Analysis, Export, Assign Engineers)
- **Filter bar**: search + dropdowns (Priority, Module, Engineer, Status, Generated From, AI Confidence, Tag/Type) + clear button
- **Center**: 6-column Kanban board (Backlog → Ready for Review → In Progress → Waiting for AI Fix → Waiting for Validation → Done)
- **Right sidebar**: live project statistics
- **Card detail drawer**: slides in from right when clicking a card

## Kanban Columns (6)
1. Backlog
2. Ready for Review
3. In Progress
4. Waiting for AI Fix
5. Waiting for Validation
6. Done

## Card (collapsed, on board)
- Priority badge (🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low)
- Task type icon + title
- Module tag
- AI confidence bar
- Engineer avatar (if assigned)
- Acceptance criteria progress (e.g. 3/5)
- Task ID (e.g. PULSE-001)

## Card Detail Drawer
- Full task info: description, reason AI created this, AI reasoning, confidence, evidence, suggested fix, prompt for coding agent, potential risks, dependencies, related tasks
- Acceptance criteria checklist (interactive)
- Related files + components
- Status lifecycle visualizer (Generated → Ready → Assigned → In Progress → AI Fix Generated → Validation → Completed)
- Action buttons: Open Code, Open Preview, View Evidence, Generate AI Fix, Assign Engineer, Move Card, Complete
- Engineer notes textarea

## Drag and Drop
- HTML5 drag-and-drop API
- Card picks up visual state (opacity/rotation)
- Column highlights on dragover
- Status updates on drop
- Smooth transitions

## Filtering
- Priority (Critical/High/Medium/Low)
- Module (Auth, Inbox, Billing, AI, Search, Widget, Analytics, Database, Notifications, UI/UX, Deployment)
- Engineer (Unassigned, plus 4 engineer names)
- Status (6 columns)
- Generated From (PRD, Planning Mode, Generated Code, Architecture, Static Analysis, Runtime Analysis, AI Recommendation, Database Analysis, Generated UI, API Analysis, Requirements, Acceptance Criteria)
- AI Confidence (High >85%, Medium 70-85%, Low <70%)
- Tag/Type (28 task types)
- Search by title/description

## Right Sidebar Stats
- Tasks Generated (total)
- Completed / Remaining
- Critical / Blocked
- Average Review Time
- Average AI Confidence
- Top Modules requiring review (bars)

## Data Model
43 tasks across 28 task types with: id, title, description, type, status, priority, module, origin, confidence, reasonAI, aiReasoning, evidence, suggestedFix, promptForAgent, potentialRisks, dependencies, relatedTasks, acceptanceCriteria[], relatedFiles[], relatedComponents[], estReviewTime, estFixTime, engineer, tag

## Design Style
Linear/GitHub/Jira dark enterprise. Rounded cards. Minimal. Fast scanning. Professional spacing.

## Acceptance Criteria
- [ ] 6-column Kanban board with draggable cards
- [ ] Cards move between columns via drag-and-drop, status persists
- [ ] Card detail drawer opens on click with full task info
- [ ] 28 task types represented across 43 cards
- [ ] 4 priority levels with colored badges
- [ ] Filter bar with 7+ filter dimensions
- [ ] Right sidebar with live stats
- [ ] Header with progress ring and action buttons
- [ ] Status lifecycle visualizer in detail drawer
- [ ] Acceptance criteria checkboxes are interactive
- [ ] No console errors
- [ ] Responsive (board scrolls horizontally on narrow screens)
