# Bug Tracker — Phase 1: Status model + PATCH findings API

Ticket: #12745. Findings gain a trackable lifecycle and a mutation endpoint,
in both the local JSON store and PostgreSQL mode. This is the foundation for
the standalone Bugs view (#12746, #12747).

## Changes

### 1. `server/store.js` — status helpers + backfill
- Export `FINDING_STATUSES = ['open','in_progress','fixed','wont_fix']` and
  `FINDING_STATUS_DEFAULT = 'open'`.
- Export `isFindingStatus(value)`.
- Export `normalizeFindingStatus(finding)` → returns a new object with
  `status` (defaulted to `open`), `statusTs` (defaulted to `finding.ts`), and
  a trimmed `statusNote` (`''` when absent). Never mutates the input.
- `createSession` findings: `options.findings` are normalized through
  `normalizeFindingStatus` at creation.
- New export `setFindingStatus(session, findingId, { status, note })`:
  - Finds the finding by id in `session.findings`; unknown id → throws
    `Error` with `code = 'QASE_FINDING_NOT_FOUND'`.
  - Validates `status` against the enum, note ≤ 500 chars (trimmed); invalid
    → `code = 'QASE_FINDING_STATUS_INVALID'`.
  - Mutates the finding in place: `status`, `statusTs: Date.now()`,
    `statusNote` (empty string clears).
  - Returns the updated finding.
- New export `aggregateFindings({ ownerUserId, status, severity, runId, search, limit })`
  (used fully by Phase 2; introduced here as the read-path contract):
  - Iterates all sessions owned by `ownerUserId` (falsy owner → all sessions,
    mirroring `getSession`).
  - Skips non-QA modes (`sqa`, `founder`) — the bug table tracks QA defects.
  - Builds rows: `{ id, runId, runTitle, runStatus, targetUrl, title, severity, category, url, ts, status, statusTs, statusNote }`.
  - Filters: `status` (enum), `severity` (enum), `runId` (exact), `search`
    (case-insensitive substring on title/category/url).
  - Sorts severity-major (critical→info, SEVERITY_ORDER) then newest `ts` first.
  - `limit` default 200, clamped 1–500. Returns array.

### 2. `server/localServices.js`
- Import `aggregateFindings`, `setFindingStatus` from `./store.js`.
- `runStore` gains:
  - `async setFindingStatus(session, findingId, patch)` → calls the store fn
    then `commit(session, 'finding_status', { finding })` so the mutation is
    persisted AND broadcast on the run bus (SSE). Returns updated finding.
  - `async aggregateFindings(options)` → passthrough to store fn.

### 3. `server/app.js` — new route
- `PATCH /api/sessions/:id/findings/:findingId`:
  - `requireSession` (404 when session unknown or not owned).
  - Role gate like sqa/observations: 403 unless `role` is empty or
    `owner`/`admin`.
  - Body `{ status, note? }`. `status` must be one of the enum → 400 otherwise
    (`QASE_FINDING_STATUS_INVALID` → 400 mapping; other validation errors →
    400; `QASE_FINDING_NOT_FOUND` → 404).
  - Calls `services.runs.setFindingStatus`; responds `{ ok: true, finding }`.
  - `RunVersionConflictError` bubbles to the existing 409 handler.

### 4. `server/postgres/migrations/015_finding_status.sql`
```sql
-- Qase PostgreSQL migration 015
-- Finding lifecycle tracking: status + note + timestamp, defaulting to open.
ALTER TABLE qa_findings ADD COLUMN IF NOT EXISTS status text;
UPDATE qa_findings SET status = 'open' WHERE status IS NULL;
ALTER TABLE qa_findings ALTER COLUMN status SET NOT NULL;
ALTER TABLE qa_findings DROP CONSTRAINT IF EXISTS qa_findings_status_enum;
ALTER TABLE qa_findings ADD CONSTRAINT qa_findings_status_enum
    CHECK (status IN ('open','in_progress','fixed','wont_fix'));
ALTER TABLE qa_findings ADD COLUMN IF NOT EXISTS status_note text
    CHECK (status_note IS NULL OR length(status_note) <= 500);
ALTER TABLE qa_findings ADD COLUMN IF NOT EXISTS status_at bigint;
ALTER TABLE qa_findings DROP CONSTRAINT IF EXISTS qa_findings_status_at_positive;
ALTER TABLE qa_findings ADD CONSTRAINT qa_findings_status_at_positive
    CHECK (status_at IS NULL OR status_at >= 0);
CREATE INDEX IF NOT EXISTS qa_findings_status_idx
    ON qa_findings (organization_id, project_id, run_id, status);
```
- Update `server/postgres/migrations.test.js` expected list (12→13, name
  `finding_status`) and add content assertions.

### 5. `server/postgres/runRepository.js`
- `hydrateFinding`: read `status`/`status_note`/`status_at` → `status`,
  `statusNote`, `statusTs` (default `open`/`''`/`ts`), using
  `normalizeFindingStatus`-compatible shaping.
- Findings SELECT (hydrateRows + any other finding reads): add `status,
  status_note, status_at` columns.
- `replaceChildren` findings INSERT: persist the three new fields
  (`status ?? 'open'`, trimmed `statusNote` or null, `statusTs` bigint).
- `commit` with event `'finding_status'` must rewrite the findings group —
  map `'finding_status'` → `['findings']` in `EVENT_CHILD_GROUPS`.

### 6. `server/qaTools.js`
- `report_finding.run` stamps `status: 'open', statusTs: finding.ts,
  statusNote: ''` on newly created findings.

## Acceptance criteria
- [ ] `setFindingStatus` validates status enum + note length; unknown finding id throws `QASE_FINDING_NOT_FOUND`.
- [ ] PATCH route: 401 without auth, 403 with bad CSRF or non-owner role, 404 unknown session/finding, 400 invalid status, 200 happy path returns updated finding.
- [ ] Legacy findings without status read back as `open` (store normalize + Postgres hydrate default).
- [ ] Local store: PATCH-persisted status survives a reload from disk.
- [ ] Postgres migration 015 in checked set; repository round-trips status.
- [ ] `finding_status` event broadcast on the run bus after a status change.
- [ ] Unit tests: store (`server/store.test.js`), services (`server/localServices.test.js`), route (`server/app.test.js`), migrations + repository round-trip.

## Edge cases
- Concurrent PATCH → optimistic lock conflict → 409 (Postgres mode).
- Note over 500 chars → 400.
- Re-patching an already-fixed finding (allowed; statusTs updates).
- Empty findings array / no findings → 404 on any id.
- Search with unicode/regex metacharacters must not throw.
