# QASE V1 UI Implementation Plan

Status: planned slices; no implementation in this branch yet
Certified baseline: `f15183bf321c683a4585298f0e415e240747f25a`

## Delivery rules

- Implement one reviewable slice at a time and keep certified backend behavior unchanged.
- Prefer existing APIs. Any backend gap is a separate additive contract change with authorization and OpenAPI tests.
- Every slice must preserve Phase 1 auth/ownership, Phase 2 outcomes/counts/report truthfulness, scheduler reliability, HMAC separation, and execution/evidence protections.
- Do not migrate frontend frameworks during V1 stabilization.
- Do not combine visual cleanup with provider, BrowserStack, scheduler, or execution-engine changes.

## UI-1 — Shell and navigation

Goal: introduce the stable product shell and route hierarchy without changing page behavior.

Expected files:

- `public/index.html`, `public/styles.css`, `public/router.js`, `public/app.js`, `public/shared.js`
- likely new `public/shell.js`
- server SPA route allow-list in `server/index.js`
- route/responsive tests

API dependencies: `/api/auth/me`, `/api/auth/logout`, `/api/projects`, existing config/theme behavior.

Backend changes: only Express SPA route aliases for `/overview`, `/test-cases`, `/findings`, `/reports`, `/integrations`, and `/settings`; no data API change.

Acceptance criteria:

- Sidebar order exactly matches the approved IA.
- `/tests` and `/bugs` remain compatible aliases.
- Desktop, tablet, and mobile navigation are keyboard operable.
- Identity, role, theme, permitted Settings, and Sign out are reachable on mobile.
- Project changes clear stale page state and reload current-page data.
- Unauthenticated requests continue to reach the dedicated login page.

Risks: boot-order regressions, old hash links, role-gated Settings exposure, duplicate listeners, session deep links.

Tests: route aliases/deep links, auth redirect, role visibility, mobile drawer focus/escape, mobile sign-out, project switching, light/dark persistence.

## UI-2 — Overview

Goal: make `/overview` the useful post-login home.

Expected files:

- `public/index.html`, `public/styles.css`, `public/router.js`, `public/app.js`
- new `public/overview.js`
- optional additive server health/summary projection and OpenAPI files only after approval

API dependencies: `/api/metrics/dashboard`, paginated `/api/sessions`, filtered/paginated `/api/findings`, `/api/health`.

Backend gaps:

- Global Provider/Worker/Browser/Scheduler health facts.
- Efficient date-window run counts at scale.

Acceptance criteria:

- New Run is the primary action.
- Active Runs, Runs This Week, Open Findings, Critical Issues, and Pass Rate have explicit zero/unavailable semantics.
- Recent runs use canonical outcomes and counts.
- Critical Findings use canonical current items.
- Health never infers subsystem readiness from process health and shows Not reported when unsupported.
- All blocks have loading, empty, partial-error, and retry states.

Risks: extra list requests, count semantics, owner/project leakage, 0% vs unavailable confusion.

Tests: metrics mapping, canonical duplicates, project/user isolation, mixed endpoint failures, empty project, responsive cards/table.

## UI-3 — New Run

Goal: replace the idle-session/composer ambiguity with one explicit mission form.

Expected files:

- `public/index.html`, `public/styles.css`, `public/app.js`, `public/missionIntent.js`
- new `public/newRun.js`
- focused request-mapping tests

API dependency: `POST /api/v1/missions`; existing projects/device/provider configuration.

Backend changes: none for Standard. Quick Smoke and Deep QA remain unshipped until an approved mapping exists.

Acceptance criteria:

- Target URL and testing request are obvious and validated.
- Standard maps to `full_audit` and existing defaults.
- Advanced fields map only to supported request fields.
- Submission creates one mission, not an idle session followed by a separate mission.
- Queued response is represented truthfully; session navigation occurs when a session ID exists.
- No implicit schedule is created.
- Secrets are not requested in the default form.

Risks: breaking the simple `/sessions/:id/message` steering flow, duplicate submissions, unsupported device/provider values, SSRF error presentation.

Tests: exact request shape, double-submit prevention, validation errors, queued start, ownership, scheduler delta zero, route transition.

## UI-4 — Run detail

Goal: make live application work primary while preserving all execution and evidence behavior.

Expected files:

- `public/index.html`, `public/styles.css`, `public/app.js`, `public/executionDetail.js`, `public/pipeline.js`, `public/shared.js`
- optional focused run-view modules extracted without changing API logic

API dependencies: session/detail/SSE, stop/answer/credentials, evidence/artifacts, mission and report APIs already in use.

Backend gap: optional structured authentication challenge metadata; not required to restyle current credential flow.

Acceptance criteria:

- Header shows target, canonical status, duration, pages, actions, current canonical findings, and independent report availability.
- Health shows Provider/Worker/Browser/Target from existing execution facts.
- Desktop layout prioritizes browser left and five detail tabs right.
- Awaiting Input and Authentication Required are first-class and resume the same session.
- No credential value reaches logs, messages, findings, reports, or persisted browser state.
- Live-disconnected, never-started, blocked, and persisted-evidence states are distinct.
- A report cannot promote a non-success outcome.

Risks: SSE reconnection, lazy detail fetches, frame sizing, stop races, historical records lacking normalized fields, credential regressions.

Tests: all canonical states, report/outcome matrix, counts, SSE updates, lazy load/error, credentials redaction/resume, stop, artifact authorization, responsive browser/tabs.

## UI-5 — Findings

Goal: rename and simplify the Bugs hub while preserving finding APIs and lifecycle.

Expected files:

- `public/index.html`, `public/styles.css`, `public/router.js`, `public/bugs.js`, `public/app.js`
- optional rename to a new `public/findings.js` only with a temporary compatibility import
- findings UI regression tests

API dependencies: existing `/api/findings` list/detail/mutation/comment/link/export/revalidation/validation APIs and artifact/evidence retrieval.

Backend gap: optional facets/taxonomy endpoint. Current fixed existing category taxonomy is preferable to current-page-derived options.

Acceptance criteria:

- UI consistently says Finding/Findings; `/bugs` and backend contracts remain valid.
- One scroll owner; sticky filters; reachable pagination before/after results or persistent footer.
- Server-side search/filter/sort and 50-item bound remain intact.
- Counts clearly distinguish canonical current findings from stored duplicate records.
- Detail contains all required observed/expected/reproduction/evidence/status fields.
- Existing revalidate and improvement-prompt actions remain permission checked.
- No future Coding Agent action is shown.

Risks: losing deep links, changing lifecycle values, accidental full-store fetch, duplicate count regression, oversized evidence.

Tests: 8,001-record pagination, filter/search query mapping, count labels, `/bugs` alias, evidence access, normal-user foreign 404, mobile reachability.

## UI-6 — Reports

Goal: add a truthful report index and reusable report detail presentation.

Expected files:

- `public/index.html`, `public/styles.css`, `public/router.js`, `public/app.js`
- new `public/reports.js`
- optional additive report summary route/projection, OpenAPI, and tests after approval

API dependencies: session summaries, mission reports, `/api/sessions/:id/report.md`, current finding APIs.

Backend gap: paginated owner/project-scoped report summaries or additive report metadata in paginated session summaries.

Acceptance criteria:

- Reports list outcome and availability separately.
- Failed, blocked, partial, cancelled, and completed reports all remain representable.
- Snapshot and current finding counts are labeled.
- Missing/pruned artifacts do not produce false active links.
- Empty/loading/error/pagination states are complete.

Risks: N+1 report downloads, unauthorized cross-run links, snapshot ambiguity, report-exists-equals-success regression.

Tests: outcome/availability matrix, historical metadata fallback, count semantics, owner isolation, missing artifact, pagination.

## UI-7 — Test Cases, Workflows, and Schedules

Goal: align mature secondary surfaces with the shell and shared interaction patterns.

Expected files:

- `public/index.html`, `public/styles.css`, `public/tests.js`, `public/workflows.js`, `public/schedules.js`, `public/shared.js`
- focused responsive and API-contract tests

API dependencies: existing test-case, suite, workflow, schedule, regression, and export routes.

Backend gaps: server pagination/filtering for large Test Case and Workflow stores; structured schedule-deferred error details if not preserved by the shared helper.

Acceptance criteria:

- Tests is labeled Test Cases while APIs stay unchanged.
- Common table/list, loading, empty, error, dialog/drawer, and pagination patterns are used.
- Relationships back to source run/workflow/suite are visible.
- Schedules are explicitly created only on the Schedules surface.
- Stale auto-schedule controls are absent from Settings.
- Deferred Run Now is truthful and does not imply execution started.

Risks: scheduler reliability regression, bulk execution, destructive actions without confirmation, large unpaginated lists.

Tests: create/edit/delete/clone/run permissions, explicit schedule creation, normal mission schedule delta zero, concurrency-deferred UI, empty/error/mobile states.

## UI-8 — Settings and Integrations

Goal: replace the oversized Settings dialog with navigable, role-safe pages.

Expected files:

- `public/index.html`, `public/styles.css`, `public/router.js`, `public/app.js`, `public/shared.js`
- new `public/settings.js` and `public/integrations.js`
- auth/role and secret-redaction UI tests

API dependencies: `/api/config`, config updates/tests, `/api/auth/me`, `/api/auth/users`, existing admin user creation.

Backend changes: none unless page-level permission metadata is desired; existing middleware remains authoritative.

Acceptance criteria:

- Integrations contains existing provider and BrowserStack configuration only.
- Settings contains supported execution/general and Team Access controls.
- Non-admin users cannot access admin content by direct route or API.
- Masked secrets never become readable or logged.
- Save/test operations have scoped progress, success, and error states.
- No implicit schedule option is presented.

Risks: exposing admin routes, overwriting masked secrets, conflating provider and BrowserStack tests, modifying certified defaults.

Tests: viewer/operator/admin route and action matrix, direct URL access, masked-secret round trip, save failure, mobile forms.

## UI-9 — Responsive and accessibility certification

Goal: certify the redesigned product across input methods and viewport classes after functional slices land.

Expected files:

- `public/styles.css`, semantic markup/modules touched by UI-1 through UI-8
- `tests-real/responsive/*` and new accessibility-focused browser tests

API dependencies: none beyond the pages under test.

Backend changes: none.

Acceptance criteria:

- Desktop, tablet, and mobile layouts meet the specification without horizontal page scrolling.
- Navigation, identity, settings, theme, and sign-out are always reachable.
- Dialogs/drawers trap and restore focus; Escape and close controls work.
- All actions are keyboard operable with visible focus.
- Labels, errors, status updates, tabs, tables/lists, and live regions expose correct semantics.
- Color is not the sole status indicator; contrast and reduced motion are supported.
- Findings pagination and run evidence remain reachable on small screens.

Risks: accumulated stylesheet specificity, fixed viewport heights, dynamically inserted controls, live-log focus churn.

Tests: viewport matrix, keyboard-only journeys, axe/manual semantic review, zoom/reflow, reduced motion, mobile sign-out, long text/URLs, loading/error/empty snapshots.

## Cross-slice regression gate

Each implementation slice should run its focused UI tests plus these guards as applicable:

- Phase 1 auth/ownership and HMAC separation.
- Phase 2 mission/run/report consistency.
- Scheduler reliability and normal-mission schedule delta.
- Execution-hotfix/runtime contract tests that do not require external BrowserStack/provider connectivity.
- OpenAPI validation whenever an additive endpoint is approved.
- JavaScript syntax checks and app `/api/health` startup smoke.

No slice is production-ready while canonical outcomes, owner isolation, artifact protection, or explicit-only scheduling regress.
