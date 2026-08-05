# Phase 16B — Workflows Page

## Goal
Surface the hidden Workflow feature as a first-class page in the Qase UI. Users can browse, search, expand, generate tests from, and delete workflows across all sessions in the active project.

## Changes
- **router.js**: Added `'workflows'` to PAGES array
- **index.html**: Added nav link (Runs · Tests · Workflows · Bugs), added `#page-workflows` container with header, stats, search, and list
- **workflows.js** (new, 292 lines): Project-scoped workflow management module
  - `loadWorkflowsPage()` — fetches all workflows via GET /api/workflows?projectId=
  - `renderWorkflowsStats()` — stat chips (count, total steps, unique targets)
  - `renderWorkflowsList()` — filtered card list with search
  - `renderWorkflowCard()` — card with name, meta, tags, expand/gen-tests/delete buttons
  - `renderWorkflowSteps()` — expandable step timeline with lazy-load (max 30 visible, "Show all" button)
  - `initWorkflowsWiring()` — search input listener
- **shared.js**: Added el refs (workflowsList, workflowsSearch, workflowsStats) + workflowState
- **app.js**: Added import + routechange handler + initWorkflowsWiring() in boot
- **styles.css**: Full workflows page CSS (~170 lines)

## Acceptance Criteria
- [x] Workflows nav link visible between Tests and Bugs
- [x] Clicking Workflows navigates to #/workflows
- [x] Page shows stats chips (workflow count, total steps, target count)
- [x] All workflows for the active project are listed as cards
- [x] Each card shows name, meta (step count, host, relative time), and action buttons
- [x] Steps button expands inline step timeline (lazy-loaded, max 30 visible)
- [x] "Show all N steps" button for large workflows
- [x] Search filters workflows by name, URL, or tags
- [x] Gen Tests button generates test cases from workflow
- [x] Delete button removes workflow
- [x] No JS console errors
- [x] Step virtualization prevents browser freeze on large workflows (177+ steps)
