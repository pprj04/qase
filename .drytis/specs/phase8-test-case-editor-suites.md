# Phase 8 — Test Case Editor & Suite Organization

## Goal

Test cases are currently read-only in the UI (LLM-generated only). This phase adds full CRUD editing, step management, test suites, tags, and clone/duplicate.

## Acceptance Criteria

### Test Case Editor
- [ ] "New Test Case" button in the Tests pane opens an editor modal
- [ ] Editor supports editing: name, severity, target URL, preconditions (add/remove), steps (add/remove/reorder), assertions (add/remove)
- [ ] Step fields: action (dropdown), target, value, description
- [ ] Assertion fields: type (dropdown), target, expected, description
- [ ] Existing test case cards have an "Edit" button that opens the same editor pre-filled
- [ ] Editing saves via PUT /api/test-cases/:id and refreshes the card
- [ ] Creating saves via POST /api/test-cases and adds a new card

### Clone/Duplicate
- [ ] Each test case card has a clone button (⧉) that creates a copy with " (copy)" suffix
- [ ] Clone gets a new id, same projectId, same steps/assertions

### Tags
- [ ] Test cases support a `tags` array (e.g. `["smoke", "auth"]`)
- [ ] Tags are editable in the test case editor (comma-separated input)
- [ ] Tags are displayed as chips on test case cards
- [ ] Tag filter: clicking a tag chip filters the test case list to that tag

### Test Suites
- [ ] New `server/suites.js` module with suite CRUD (create, list, update, delete)
- [ ] Suite entity: `{ id, projectId, parentId, name, createdAt, updatedAt }`
- [ ] Test cases have a `suiteId` field (nullable — unassigned goes to root)
- [ ] Suite tree in the Tests pane sidebar (collapsible folders, nested up to 2 levels)
- [ ] Test cases are grouped under their suite in the list
- [ ] Move test case between suites via a dropdown in the card or editor
- [ ] Creating a suite: "+ Suite" button with name prompt

### Suite-Aware Scheduling
- [ ] Schedule creation form includes a suite selector
- [ ] When a suite is selected, all test cases in that suite are included in the schedule

## Data Migration
- Existing test cases get `suiteId: null`, `tags: []` (backfilled on load)
- No suites exist initially; all test cases appear at root level

## Files to Create
- `server/suites.js` — suite CRUD + persistence to `.qase/suites.json`

## Files to Modify
- `server/testCases.js` — add `tags`, `suiteId` to schema; add `createTestCaseManual`; add `cloneTestCase`; add `listTestCases` suite filtering; backfill
- `server/index.js` — add suite routes, clone route, manual create route; add `suiteId`/`tags` to schedule form
- `server/scheduler.js` — add `suiteId` to createSchedule, add suite-aware test case resolution
- `server/projects.js` — add `reassignProjectId`/`backfillProjectId` for suites
- `public/index.html` — editor modal, suite tree container, tag filter, new test case button
- `public/app.js` — editor logic, suite tree rendering, tag filtering, clone handler
- `public/styles.css` — editor modal styles, suite tree styles, tag chips
