# Phase 4 · Test cases with multi-environment assignment

**Ticket:** #13438 · **Status:** In Progress

## Goal

A reusable **test case** entity that QA scenarios can be authored against, each assigned
**multiple testing environments**. Executions (runs) then reference the test case and the
specific environment they run under. Backward compatible: runs with no test case keep
working exactly as today.

## Data model

**Migration 017 (postgres) + local `.qase/test-cases.json` (mirror environments pattern):**

- `test_cases` (tenant-scoped): `id uuid PK`, `organization_id`, `project_id`,
  `case_number text` (TC-0001, monotonically increasing per project — generated server-side),
  `title text NOT NULL`, `description text`, `steps jsonb` (array of strings),
  `expected text`, `tags text[]`, `environment_ids text[]` (envIds of assigned environments,
  validated to exist and be active at assignment time — inactive ones are rejected),
  `created_at`, `updated_at`.
- UNIQUE `(organization_id, project_id, case_number)`.
- `qa_runs.test_case_id text NULL` (migration 017) — the run→case link. A run created with
  `testCaseId` must also carry `environmentId` which must be in the case's assigned set
  (else 422). Runs without a test case are untouched.

## API (server/testCaseApi.js, mounted like catalogApi)

- `GET /api/test-cases` — list with filters (search, tag, environment envId) + total.
- `POST /api/test-cases` — create (201) with server-generated TC-XXXX number; validate
  environment assignments exist+active (422 with reasons otherwise).
- `GET /api/test-cases/:caseNumber` — full record or 404.
- `PATCH /api/test-cases/:caseNumber` — update title/description/steps/expected/tags and
  ADD/REMOVE environment assignments (`addEnvironmentIds` / `removeEnvironmentIds`).
- `DELETE /api/test-cases/:caseNumber` — soft delete (`deleted` flag) so run history keeps
  resolving titles.

## Store pattern

Mirror environments: `createLocalTestCaseBackend` (Map + `.qase/test-cases.json`, atomic
write, lazy load) and `createPostgresTestCaseRepository` (RLS via set_config, ENV-style
column whitelist), behind `createTestCaseService(backend, { tenantContext, environments })`
facade validating env assignments through the environment service. Wired in
`serviceFactory.js` for both modes.

## Run integration

- `resolveTestCaseForRun` (app.js, mirrors resolveEnvironmentForRun at :60): given
  `testCaseId` + `environmentId`, 422 if the case is unknown, or the env is not assigned.
- Session-create endpoints accept optional `testCaseId`; stored on the run
  (`session.testCaseId` local; `qa_runs.test_case_id` postgres), included in run hydration,
  SSE snapshots and report context (case title rendered in report header).

## UI

Follow the deviceMatrixView module pattern: "Test cases" footer button + dialog with
- list (search + tag filter, shows assigned environment count),
- create/edit form (title, description, steps, expected, tags),
- environment assignment panel: multi-select from active environments (grouped by platform),
- per-case "Run…" action pre-fills the QA start dialog with case + environment.

Existing run creation without a test case unchanged (regression).

## Acceptance criteria

- [ ] Migration 017 creates test_cases + qa_runs.test_case_id; checksums immutable
- [ ] Local + postgres backends behind one service; both wired in serviceFactory
- [ ] CRUD API with TC-XXXX numbering, env assignment validation (unknown/inactive → 422)
- [ ] Multi-environment assignment: add/remove via PATCH; list filter by environment
- [ ] Run creation accepts optional testCaseId; env must be assigned to the case
- [ ] Runs without test cases work identically (backward compat proof)
- [ ] Test-case UI: list/create/edit/assign + run prefill
- [ ] Unit + integration tests both stores; full suite green
- [ ] Infra gate + reviewer + tester pass

## Tests

- `server/testCaseService.test.js` — numbering, assignment validation, soft delete.
- `server/testCaseApi.test.js` — CRUD + run link 422 paths + backward-compat run.
- `server/postgres/testCaseRepository.test.js` — SQL shape, RLS set_config, patch columns.
- Browser (tester): create case, assign 2 envs, start run against one via UI prefill.
