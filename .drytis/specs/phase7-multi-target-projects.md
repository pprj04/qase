# Phase 7 — Multi-Target Projects

## Goal

Introduce a **Project** entity that groups all QA artifacts (sessions, workflows, test cases, schedules, regression runs) by target site. Today everything is flat — a global namespace keyed loosely by `targetUrl`. Phase 7 adds explicit project scoping so you can manage multiple sites cleanly.

## Design

### Project entity

```
{
  id: string (UUID),
  name: string,          // e.g. "Production", "Staging"
  baseUrl: string,       // e.g. "https://app.example.com"
  createdAt: number,
  updatedAt: number
}
```

### Migration strategy — backward compatible

On boot, if no projects exist, a **Default** project is auto-created. Every existing entity without a `projectId` is assigned to it. New entities get the `projectId` from the active project context (frontend sends it as a header or query param).

### Scoping mechanism

The frontend maintains `state.projectId`. Every API call that lists or creates scoped entities sends `?projectId=` (or the body includes it). Backend filters by `projectId`.

## Files to create/modify

### NEW: `server/projects.js`
- CRUD: createProject, getProject, listProjects, updateProject, deleteProject
- `ensureDefaultProject()` — auto-creates Default if none exist
- `assignOrphanedEntities()` — one-time migration that sets `projectId` on existing entities missing one
- Persistence: `.qase/projects.json`

### MODIFY: `server/store.js`
- Add `projectId` to session shape
- Add `projectId` filter param to `listSessions({ projectId })`
- `createSession(title, projectId)` — accepts projectId

### MODIFY: `server/workflows.js`
- Add `projectId` to workflow shape
- `listWorkflows({ projectId, targetUrl })` — filter on projectId (falls back to targetUrl for compat)

### MODIFY: `server/testCases.js`
- Add `projectId` to test case shape
- `listTestCases({ projectId, targetUrl, workflowId })` — filter on projectId

### MODIFY: `server/scheduler.js`
- Add `projectId` to schedule shape
- `listSchedules({ projectId })` — filter on projectId

### MODIFY: `server/regressionStore.js`
- Add `projectId` to run shape
- `listRegressionRuns({ projectId, scheduleId, targetUrl })` — filter on projectId
- `getTrend({ projectId, ... })` — same

### MODIFY: `server/metrics.js`
- `getDashboardMetrics({ projectId })` — scope aggregation to project

### MODIFY: `server/index.js`
- New routes: `GET/POST/PUT/DELETE /api/projects`
- Pass `projectId` from query params / body into all scoped store calls
- `POST /api/sessions` accepts `projectId` in body

### MODIFY: `public/index.html`
- Project selector dropdown in the sidebar header (next to "New run")
- "New project" button or inline create

### MODIFY: `public/app.js`
- `state.projectId` — active project
- `loadProjects()` — fetch project list, populate dropdown
- All scoped API calls send `?projectId=`
- `selectProject(id)` — switches project, reloads session list + scoped data
- `refreshRuns()` — fetches sessions filtered by project

## Acceptance criteria

- [ ] Create a project with name + baseUrl
- [ ] List projects
- [ ] Update a project (rename, change baseUrl)
- [ ] Delete a project (orphaned entities reassigned to Default)
- [ ] Sessions are scoped to projectId
- [ ] Workflows are scoped to projectId
- [ ] Test cases are scoped to projectId
- [ ] Schedules are scoped to projectId
- [ ] Regression runs are scoped to projectId
- [ ] Metrics dashboard is scoped to projectId
- [ ] Frontend project selector switches context
- [ ] Backward compatible: existing data auto-assigned to Default project
- [ ] New runs, workflows, test cases, schedules get the active projectId
