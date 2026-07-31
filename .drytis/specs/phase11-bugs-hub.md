# Phase 11 — Bugs Hub

## Goal
Transform findings from ephemeral session-embedded objects into a first-class, persistent entity with a standalone Bugs Hub — a Jira-like ticket board that QA and dev teams can collaborate on.

## Current State
- Findings live ONLY inside `session.findings[]` — no global store, no independent API
- No `projectId`, `status`, `assignee`, or `sessionId` fields on findings
- No standalone bugs page — the Findings tab is session-scoped
- No lifecycle (open → in_testing → resolved → closed)
- No finding ↔ test case bi-directional linking
- No filtering, sorting, or bulk export across sessions
- No manual creation, editing, or status updates

## Architecture

### Data Model — Enhanced Finding Object
```
{
  id: "<uuid>",
  ts: <epoch>,
  sessionId: "<session-id>",       // NEW — back-reference to source session
  projectId: "<project-id>",       // NEW — project scope
  title: "string",
  severity: "critical|high|medium|low|info",
  category: "string",
  url: "string",
  status: "open|in_testing|resolved|closed",  // NEW — lifecycle
  steps: ["string"],
  expected: "string",
  actual: "string",
  evidence: "string",
  testCaseIds: ["tc-id"],          // NEW — linked test cases
  assignee: "string|null",         // NEW — optional assignee
  comments: [{                     // NEW — activity log
    id, ts, author, text
  }],
  history: [{                      // NEW — status change timeline
    ts, from, to, by
  }],
  screenshotPath: "string|null",   // NEW — optional evidence screenshot
  tags: ["string"],               // NEW — free-form tags
}
```

### Files to Create
1. **`server/findings.js`** — Global findings store (CRUD, lifecycle, filtering)
2. **`server/bugExporters.js`** — Per-bug ticket export (GitHub issue, JIRA, Linear, markdown)

### Files to Modify
1. **`server/store.js`** — Auto-sync new findings from sessions into global store
2. **`server/qaTools.js`** — `report_finding` tool writes to global store with projectId/sessionId
3. **`server/index.js`** — Add finding routes (CRUD, lifecycle, linking, export)
4. **`server/projects.js`** — Add findings to `assignOrphanedEntities` + `reassignEntities`
5. **`server/exporters.js`** — Add cross-session export path
6. **`server/testCases.js`** — Add `findingId` field support for bi-directional linking
7. **`public/index.html`** — Add top-level Bugs tab
8. **`public/app.js`** — Bugs Hub UI (board, detail, filters, lifecycle controls)
9. **`public/styles.css`** — Bugs Hub styles

---

## Sub-Phases

### 11A — Global Findings Store + Migration
**Backend foundation: persistent store, data migration, API surface**

- Create `server/findings.js`:
  - `.qase/findings.json` persistence (debounce-write pattern matching testCases.js)
  - `addFinding(data)` — create with auto-generated id, ts, status="open"
  - `listFindings({ projectId, severity, status, category, assignee, sessionId, q })` — filtered query
  - `getFinding(id)` — single finding with computed fields (session info)
  - `updateFinding(id, patch)` — partial update (title, severity, assignee, etc.)
  - `deleteFinding(id)` — remove + cleanup references
  - `changeStatus(id, newStatus, by)` — append to history[], update status
  - `addComment(id, author, text)` — append to comments[]
  - `linkTestCase(findingId, testCaseId)` / `unlinkTestCase(findingId, testCaseId)`
  - `syncSessionFinding(session, finding)` — sync session-embedded finding → global store
  - `migrateFromSessions()` — one-time migration: flatten all `session.findings[]` into global store

- Migration logic:
  - On first boot if `.qase/findings.json` doesn't exist, iterate all sessions
  - For each `session.findings[]`, create a global entry with sessionId/projectId back-filled
  - Deduplicate by title+url (keep earliest ts)
  - Write migration marker to prevent re-running

- Add routes to `server/index.js`:
  - `GET /api/findings?projectId=&severity=&status=&category=&q=` — list/filter
  - `GET /api/findings/:id` — detail (includes linked test cases, session info)
  - `POST /api/findings` — manual create
  - `PUT /api/findings/:id` — edit
  - `DELETE /api/findings/:id` — delete
  - `PATCH /api/findings/:id/status` — change status (with history)
  - `POST /api/findings/:id/comments` — add comment
  - `POST /api/findings/:id/link/:testCaseId` — link test case
  - `DELETE /api/findings/:id/link/:testCaseId` — unlink test case
  - `GET /api/findings/export?format=github|jira|linear|markdown&projectId=` — bulk export

- Modify `server/qaTools.js` `report_finding` tool:
  - After pushing to `session.findings[]`, also call `addFinding()` in global store
  - Pass `sessionId` and `projectId` from the active session

- Modify `server/projects.js`:
  - `assignOrphanedEntities()` — backfill projectId on findings missing it
  - `reassignEntities(oldProjectId, newProjectId)` — reassign findings

### 11B — Bugs Hub UI (Board + Detail + Filters)
**Frontend: top-level Bugs tab with board view, detail drawer, filtering**

- Add top-level "Bugs" tab to navigation bar (left sidebar, above Sessions or as peer)
- Bugs Hub board view:
  - **Filter bar**: severity dropdown, status dropdown, category dropdown, search box, project selector
  - **Summary stats**: counts by status (X open, Y in testing, Z resolved)
  - **Bug cards**: severity badge, title, category, URL, age (time since filed), status badge, assignee
  - **Sort**: newest, oldest, severity, status
  - Click a card → open detail drawer
- Bug detail drawer:
  - Full finding info (steps, expected, actual, evidence)
  - Status lifecycle controls (dropdown: open → in_testing → resolved → closed)
  - Assignee field (editable text)
  - Linked test cases list (with link/unlink controls)
  - Comments section (add comment, timeline)
  - Status history timeline
  - Export buttons (GitHub issue / JIRA / Linear / Copy as ticket / Markdown)
  - Edit button (inline edit title, severity, category)
  - Delete button (with confirmation)
- Manual bug creation:
  - "+ New Bug" button → modal form (title, severity, category, url, steps, expected, actual, evidence)

### 11C — Cross-Session Export + Bug↔Test Linking UI
**Integration: export across sessions, bi-directional test case linking in both directions**

- Cross-session export:
  - "Export All" button on Bugs Hub → modal to choose format (GitHub/JIRA/Linear/Markdown)
  - Exports ALL findings matching current filters (not session-scoped)
  - GitHub format → array of issue objects
  - JIRA format → array of JIRA issue objects
  - Linear format → array of Linear issue objects
  - Markdown → consolidated bug report document
- Bug ↔ Test Case bi-directional linking:
  - In Bugs Hub detail drawer: list linked test cases, dropdown to add more, unlink buttons
  - In Tests tab expanded card: show linked bug badges (clickable → jumps to bug detail)
  - `server/testCases.js`: `testCase.findingIds[]` field
  - Linking from either direction updates both sides
- Activity timeline:
  - Shows: creation, status changes, comments, test case links/unlinks
  - Each entry has timestamp and actor (agent/user/system)

---

## Acceptance Criteria

### 11A — Store + Migration
- [ ] `server/findings.js` exists with CRUD, lifecycle, filtering, persistence
- [ ] `.qase/findings.json` created on migration with all existing findings
- [ ] Migration is idempotent (runs once, doesn't duplicate)
- [ ] `report_finding` tool writes to both session and global store
- [ ] `projectId` backfilled on all migrated findings
- [ ] All 10 API routes respond correctly
- [ ] `assignOrphanedEntities` handles findings
- [ ] Integration tests: create, list, filter, update, delete, status change, comment, link, export

### 11B — UI
- [ ] Top-level "Bugs" tab visible in navigation
- [ ] Bug cards render with severity badge, status badge, title, category
- [ ] Filter by severity, status, category, search all work
- [ ] Bug detail drawer opens on card click
- [ ] Status lifecycle dropdown works (open → in_testing → resolved → closed)
- [ ] Comments can be added and displayed
- [ ] Manual bug creation works via modal
- [ ] Edit and delete work
- [ ] No console errors

### 11C — Export + Linking
- [ ] Cross-session export produces correct format (all 4 formats)
- [ ] Export respects active filters
- [ ] Bug → test case linking works from detail drawer
- [ ] Test case → bug badges appear on expanded test cards
- [ ] Linking from either direction updates both sides
- [ ] Activity timeline shows all events
- [ ] Integration tests for export and bi-directional linking

## Test Plan
- Unit: `server/findings.js` — all CRUD/filter/lifecycle methods
- Integration: API routes (create → list → filter → update → status → comment → link → export → delete)
- Integration: migration idempotency (run twice, no duplicates)
- Integration: finding created by agent → appears in global store with projectId
- Browser: Bugs Hub board, filters, detail drawer, lifecycle, comments, manual create, export
