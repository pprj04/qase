# User Feedback After QASE Automation Testing — Feature Spec

Branch: MANOJ. Goal: after a run completes (done OR error), users can submit feedback (rating, category, comments, optional suggestions) auto-associated with the run; authorized users can review submissions in a Feedback admin area.

## Grounding (from codebase research)

- Completion is detected two ways: SSE `status` event (`app.js:2272-2303`) and `applySessionSnapshot` (`app.js:418-450`). The completion surface is the run timer/status chip (`updateRunTimer`) plus the Report tab's `.report-actions` row (`renderReport`, `app.js:1405-1479`) — no dedicated completion view exists.
- Modal convention: native `<dialog class="modal" id="...">` with `modal-inner/-head/-body/-foot`, ref-object pattern (`openQaStart`, `app.js:2329-2400`), inline error div, busy state on submit.
- Services: `assertApplicationServices` (`server/contracts.js`) validates required groups; both local (`localServices.js`) and Postgres (`postgresServices.js`) adapters share `createRuntimeApplicationServices` (`localServices.js:20-126`). Precedent for optional methods: `runs.durationAnalytics` guarded by `typeof === 'function'` at route level.
- Persistence: dev runs `QASE_RUN_STORE=local` (`.qase/*.json`). Postgres child-table precedent: `qa_reports` keyed `(organization_id, project_id, run_id)` with RLS. Highest migration on MANOJ = 014; `migrations.test.js` hard-asserts the full ordered list in three places (must be updated for 015).
- Auth: all `/api/*` behind cookie token + double-submit CSRF + `runWithRequestActor`; roles exist (`auth.js` role on user, default 'developer', owner/admin used by SQA review route) — feedback review gated to `['owner','admin']` following `app.js:493` precedent. Owner scoping via `requireSession` + `request.auth.userId`.

## Phase 1 · Feedback domain: service contract, stores, migration

- `server/contracts.js`: add `feedback` group: `create`, `get`, `list`, `update`, `remove`, `stats` (validated by `assertApplicationServices`).
- Feedback record shape: `id, runId, targetUrl, runStatus, durationSeconds, rating (1-5), category, comments, improvement (optional), status ('new'|'reviewed'|'in_progress'|'resolved'|'closed'), submittedBy (userId), submittedAt, updatedAt`.
- Local store: persist to `.qase/feedback.json` via atomic write (same as sessions/auth), owner-scoped through `currentRequestActor()`.
- Postgres: migration `015_run_feedback.sql` — `qa_run_feedback` child table keyed `(organization_id, project_id, run_id)` + own id, following `qa_reports` pattern with RLS; repository methods in `runRepository.js` (or a small `feedbackRepository.js`), update all THREE assertion sites in `migrations.test.js` (names, applied-order, currentVersion 15).
- Duplicate prevention: one feedback record per run per user — DB unique constraint + service-level check; API returns existing rather than 409 (update-in-place semantics via PUT).

## Phase 2 · Feedback APIs

- `server/app.js` routes (all behind existing auth + CSRF):
  - `POST /api/feedback` — body `{ runId, rating, category, comments, improvement? }`; server enriches from the run (targetUrl, runStatus, durationSeconds) — user NEVER re-enters run data. Validates runId exists + owned by actor, run is terminal (`done`/`error`). Rating 1-5 integer; category in fixed enum (test_accuracy, test_coverage, execution_speed, results, ui_ux, automation_quality, error_handling, ease_of_use, overall, other); comments required, trimmed, length 1-4000; improvement 0-4000. Returns 400 with field errors; 409 on duplicate with the existing record id.
  - `GET /api/feedback` — list; OWNER/ADMIN ONLY (role gate like SQA review); filters: runId, targetUrl/project, rating, category, status, date range, `q=` search over comments; pagination.
  - `GET /api/feedback/:id` — owner/admin; includes the associated run summary (so reviewer can trace the execution).
  - `PUT /api/feedback/:id` — owner/admin: status transitions + optional category/comments edits (review workflow).
  - `DELETE /api/feedback/:id` — owner/admin.
  - `GET /api/feedback/stats` — totals, average rating, per-category breakdown, per-status counts (for admin panel).
  - `GET /api/sessions/:id/feedback` — the submitter's own feedback for a run (used by the completion UI to show "already submitted" / allow edit).
- Sanitization: comments rendered as TEXT nodes only in UI; server strips control chars and enforces lengths; never echo secrets; run metadata limited to the safe fields above.
- Tests: `server/feedback.test.js` — happy path, validation matrix (empty/overlong/invalid rating/category), duplicate, non-terminal run, wrong owner 401/404, admin gate for GET/PUT/DELETE, status transitions, stats correctness.

## Phase 3 · Frontend: completion feedback flow

- `public/index.html`: `<dialog class="modal feedback-modal" id="feedback">` following QA-start structure: star rating (5 radio buttons styled as stars), category select, comments textarea, optional improvement textarea, inline error div, submit with busy state.
- `public/app.js`:
  - "Provide Feedback" button appended to `.report-actions` in `renderReport()` (QA mode) and the SQA/founder report action rows; ALSO a compact feedback button in the header next to the completed timer state (shown when `done`/`error`), so feedback is available regardless of active tab.
  - Button visible for both `done` and `error` statuses.
  - Modal pre-fills nothing (run data fetched server-side); if `GET /api/sessions/:id/feedback` returns existing feedback, open in "edit" mode pre-filled and change submit label.
  - Submit: disabled until rating + category + non-empty comments; loading state; on network/server failure keep entered data + show inline error + retry; on success show "Feedback submitted successfully — thank you for helping us improve QASE!" state, disable re-submit.
  - After a run completes, mark feedback availability (one-shot guard per `session.id:completedAt`, mirroring `showCompletedFounderReport`).
- `public/styles.css`: reuse `.modal` family; star-rating styles consistent with existing buttons/chips; responsive (stacked layout on narrow viewports).
- Tests: `node --check`; existing UI tests untouched.

## Phase 4 · Admin Feedback section

- Left rail panel (pattern of perf-panel) or a new tab: "Feedback" — visible to owner/admin role users only (role surfaced via existing profile/auth API if available; else server returns 403 and panel hides).
- Shows: total submissions, average rating, feedback by category, recent feedback list; search box + filters (run ID, target/project, rating, category, date, status); status chips New/Reviewed/In Progress/Resolved/Closed with dropdown to change status (PUT); each row links/opens the associated run (trace to execution).
- Responsive; refresh on new submissions.
- Tests: route-level in Phase 2 tests; UI smoke via `node --check` and existing patterns.

## Phase 5 · QA verification + regression

- E2E script: create run → set status running→done → POST feedback → GET stats/list → PUT status → verify run record unaffected → duplicate POST rejected.
- Failed-run path: status → error → feedback available and accepted.
- Full `npm test` green; timer/perf/report features unaffected.
- Publish to origin/MANOJ.

## Non-goals

- No emails/notifications, no external survey tools, no anonymous (unauthenticated) feedback, no changes to run execution/reporting.
