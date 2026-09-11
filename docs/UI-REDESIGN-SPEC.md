# QASE V1 UI Redesign Specification

Status: audit and implementation specification only
Certified baseline: `f15183bf321c683a4585298f0e415e240747f25a`
Branch: `redesign/qase-v1-ui`

## 1. Scope and invariants

This redesign reorganizes and clarifies the existing standalone QASE interface. It does not redefine certified backend behavior. The following remain authoritative and unchanged:

- HttpOnly human-session authentication, signup, logout, role checks, and owner isolation.
- Machine bearer authentication and Drytis HMAC integration as separate authorization models.
- Mission and session APIs and their existing relationships.
- Phase 2 canonical execution outcomes and finding-count semantics.
- Scheduler admission control, occurrence claims, and explicit-only schedule creation.
- Browser execution, live frames, evidence, artifacts, reports, and finding lifecycle semantics.

The UI must consume server facts. It must not infer success from a report, a browser frame, a `done` label, or the absence of an error.

## 2. Existing frontend architecture

QASE is a server-served, framework-free SPA:

- `public/index.html` contains the authenticated shell, all five routed pages, the run workspace, and most dialogs.
- `public/login.html` is a separate unauthenticated document; `public/login.js` handles bootstrap, login, and signup.
- `public/router.js` provides path routing with legacy hash compatibility. Its page set is currently `runs`, `tests`, `workflows`, `schedules`, and `bugs`.
- `public/app.js` owns boot, project selection, runs, run detail, SSE, the composer, configuration, account state, metrics, and several analysis panels.
- Feature modules split out Findings/Bugs, Test Cases, Workflows, Schedules, pipeline intelligence, execution detail, and shared helpers.
- `public/styles.css` is one accumulated stylesheet of roughly 8,000 lines. Later phase overrides coexist with older rules, increasing layout and responsive risk.
- There is no compilation or component framework. Changes must use ES modules, semantic HTML, and existing CSS variables.

Current authenticated server routes are `/`, `/runs`, `/runs/:id`, `/tests`, `/workflows`, `/schedules`, and `/bugs`. There are no routed Overview, Reports, Integrations, or Settings pages. Unknown SPA paths currently resolve visually to Runs through the client router but are not all served by Express.

## 3. Current surface audit

### 3.1 Login and signup

What works:

- A dedicated `/login` document prevents authenticated product content from appearing before login.
- Login and signup share a focused form. Signup adds password confirmation.
- Bootstrap determines whether initial admin registration is needed.
- The backend performs credential validation, normalized-email duplicate protection, secure password hashing, and normal-user signup.
- Successful authentication redirects to `/runs`; logout revokes the server session and returns to `/login`.

Data and actions:

- `GET /api/auth/bootstrap`
- `POST /api/auth/login`
- `POST /api/auth/signup`
- `POST /api/auth/register-admin` only in bootstrap conditions

Problems:

- The login document has inline styling and does not share the authenticated product's tokens or reusable form components.
- Loading is mostly button-disable behavior; there is no consistent form progress pattern.
- Login and signup occupy the same URL with query-state behavior, so browser history and page titles need explicit treatment.
- The redesign must retain generic invalid-credential errors and never render or log tokens.

### 3.2 Overview/dashboard

Current state: no Overview route or page exists. Dashboard-like metrics appear inside the run workspace/report area, not as a post-login home.

Available data:

- `GET /api/metrics/dashboard?projectId=...` returns owner-filtered session totals/statuses, finding totals/severity, test-case metrics, regression pass rate/trend, and privileged observability blocks where allowed.
- `GET /api/sessions?projectId=...` returns newest-first owner-filtered run summaries and supports optional pagination.
- `GET /api/findings` supports filters and pagination with stored and canonical total semantics.
- `GET /api/health` is public but currently reports only process health, uptime, and product name.

Gap: a truthful global Provider/Worker/Browser/Scheduler health summary is not available. Per-session `executionHealth` exists; `schedulerStats()` exists server-side but is not exposed; `/api/health` must not be interpreted as all subsystem health.

### 3.3 Runs list and run creation

What works:

- Owner-filtered, project-scoped run listing and deep links at `/runs/:id`.
- Remembered project and session selection.
- New Run creates an empty session; a URL sent in the composer starts work.
- Mission intent fields can create and auto-start a mission.
- Delete, stop, answer, and credentials flows exist.

Data and actions:

- `GET/POST /api/sessions`
- `GET/DELETE /api/sessions/:id`
- `POST /api/sessions/:id/message`
- `POST /api/sessions/:id/stop`
- `POST /api/sessions/:id/answer`
- `POST /api/sessions/:id/credentials`
- `POST /api/v1/missions`
- session SSE at `GET /api/sessions/:id/events`

Problems:

- “New run” first creates an idle shell, while mission intent takes a separate path. The distinction is implementation-oriented and unclear to users.
- Target URL, instructions, build prompt, requirements, device, and provider controls are distributed between the transcript composer and revealable intent form.
- The empty state contains prompt chips but does not present one clear run-creation task.
- Raw session states and locally relabeled states coexist with Phase 2 normalized fields.
- Run list has no explicit loading skeleton and can degrade to inline retry content.

### 3.4 Run detail

What works:

- Live frame/browser presentation, transcript/activity, application analysis, evidence, findings, and report views.
- Execution environment metadata and per-component execution health.
- Lazy loading for large messages, captured steps, findings, and detail fields.
- SSE refresh and reconnect behavior.
- Stop and credential continuation act on the same session.
- Evidence and artifact retrieval remain owner-protected.

Data and actions:

- `GET /api/sessions/:id` and `/detail?field=...`
- `GET /api/sessions/:id/events`
- `GET /api/v1/sessions/:id/evidence?limit=200`
- `GET /api/v1/artifacts/:id/content` and protected legacy artifact routes
- `GET /api/sessions/:id/report.md`
- mission/report and analysis endpoints already called by `app.js`, `pipeline.js`, and `executionDetail.js`

Problems:

- The desktop layout is run list + transcript + browser rail. This gives the live application less prominence than the proposed core workflow.
- Header counts are partly derived client-side from captured steps and can diverge from canonical current finding count or normalized outcome.
- “No browser yet” describes live state but may read as denial of persisted execution history.
- Several panels suppress fetch failures by hiding content; loading, empty, unavailable, and error are not consistently distinct.
- “Report published” language can imply successful execution even when Phase 2 correctly says failed, blocked, or partial.

Canonical run header rules:

1. Use `executionOutcome`/`outcome.outcome` from the session or mission consistency response when present.
2. Display `Awaiting Input` when the active session is awaiting input; do not convert it to generic Running.
3. Preserve `Interrupted` when the existing session status and interruption metadata expose it.
4. Display Queued, Running, Awaiting Input, Completed, Partial, Blocked, Failed, Cancelled, or Interrupted without a generic DONE label.
5. Use server-provided canonical current finding count and semantics. Derived captured-step counts are a fallback only for historical records.
6. Show report availability as a separate fact.

### 3.5 Authentication Required state

Existing support is sufficient for a first-class presentation:

- The session can enter `awaiting_input` with `pendingQuestion.credentialLike`.
- The UI already renders username/email, password, and optional OTP fields.
- Credentials post to `POST /api/sessions/:id/credentials`.
- Secrets are held in the existing in-memory server vault and are represented to the model by placeholders.
- The same session resumes through the existing turn path.

The redesigned card should say, conservatively, “QASE needs credentials to continue this run,” include the known target host, and render only requested fields. It must not guess credentials, persist passwords client-side, include secret values in telemetry, findings, reports, DOM summaries, or console output.

Backend gap: the challenge is partly inferred from a free-form pending question. Reliably displaying an exact login destination and canonical requested-field schema would require additive structured challenge metadata. No credential vault is proposed.

### 3.6 Test Cases

What works:

- Search; severity, viewport, tag, and suite filters; suite tree; cards loaded in batches of 25.
- Create, edit, delete, clone, run one, run all, baseline approval, and JSON/CSV export.
- Loading, error, and empty states are present.

Data:

- `/api/test-cases?includeMetrics=1`, `/api/test-cases/:id`, `/api/suites`, `/api/workflows`, `/api/sessions`, and related execution/export routes.

Problems:

- The navigation says Tests while the product objects and APIs say test cases.
- Dense card actions and editor dialog mix authoring, execution, and baseline operations.
- Filtering is client-side after a broad list request; large installations need server pagination/filtering before this becomes a scalable table.
- Secondary suite/provenance failures can degrade silently.

Rename the UI route to `/test-cases`; retain `/tests` as a compatibility alias and retain all API names.

### 3.7 Workflows

What works:

- Project-scoped search, metrics, cards, expandable detail, test generation, and delete.
- Loading, empty, and error states exist.

Data:

- `GET /api/workflows?includeMetrics=1`, `GET /api/workflows/:id`, test generation, update/delete endpoints.

Problems:

- Expansion and “show all” behavior lives inside cards and becomes dense.
- The list is not paginated.
- The relationship among captured workflows, generated test cases, and originating runs needs clearer links.

### 3.8 Schedules

What works:

- Explicit creation, enable/disable, Run Now, delete, statistics, and regression trend.
- Scheduler reliability prevents implicit normal-mission scheduling and bounds scheduled dispatch.
- Loading, empty, and error states exist.

Data:

- `/api/schedules?includeMetrics=1`, `/api/schedules/:id`, `/api/schedules/:id/run`, `/api/schedules/:id/runs`, `/api/suites`, `/api/test-cases`, `/api/regression/trend`.

Problems:

- A deferred Run Now response can surface as a generic toast because the shared request helper discards some structured error context.
- Delete has no strong confirmation treatment.
- Settings still exposes stale implicit auto-schedule wording although the certified backend disables pipeline-created schedules. The redesign must remove that misleading control from the presentation; schedules remain explicit through the scheduling surface/API.

### 3.9 Bugs/Findings

What works:

- Backend semantics are already findings, with category, severity, lifecycle/fix status, evidence, comments, links, revalidation, validation history, improvement prompts, and exports.
- `GET /api/findings` supports server filtering, search, sorting, `limit`/`offset`, and both stored-record and canonical-current totals.
- Current regression coverage verifies an 8,001-record store renders only a 50-item page.

Rename recommendation: change the user-facing term and primary route to Findings because the model includes functional, UX, accessibility, permission/security, API, and AI-output issues. Preserve `/bugs` as a route alias and preserve `/api/findings` and data values. Do not migrate backend records.

Historical clipping root cause:

- The old client fetched and rendered the full findings collection.
- Filtering was entirely client-side and there were no page controls.
- `.bugs-page` used a fixed viewport height with `overflow:hidden`; only the nested board wrapper scrolled.
- Thousands of DOM cards inside that nested scroller made results and controls effectively unreachable and degraded performance.

The certified baseline has already corrected the unbounded fetch with 50-item server pagination. Remaining redesign work:

- Make the document/main content region the single vertical scroll owner where practical.
- Keep filter/search controls sticky below the product header.
- Put pagination in a persistent footer or expose it above and below results; do not require scrolling through 50 cards to reach Next.
- Preserve server-side search/filter/sort.
- Label counts explicitly: “N current findings” for `canonicalTotal`; expose stored/duplicate count only as secondary diagnostic information.
- Do not derive category options solely from the current page. Use a fixed existing taxonomy or a backend facet endpoint if one is added.
- Replace action-dense cards with a responsive table/list and a clear detail drawer/page.

Every finding detail must show title, severity, category, affected page/area, observed behavior, expected behavior, reproduction steps, evidence, and current status. Existing actions may be relabeled as View Evidence, Re-run/Revalidate, and Generate/View Improvement Prompt. “Send to Coding Agent” is future scope and must not appear until an authorized API exists.

### 3.10 Reports

Current state: there is no Reports page. Reports are viewed inside run detail; mission structured reports, Markdown reports, development reports, and regression summaries are separate existing surfaces.

Required truth model:

- Execution outcome and report availability are separate fields.
- Summary shows outcome, scenario/test counts, canonical current findings, severity distribution, report availability, and snapshot/current semantics.
- A stale snapshot is labeled with its captured count and timestamp beside the current canonical count.
- Copy must support “Report available — execution failed/blocked/partial.”

Backend gap: a scalable Reports index needs an owner-filtered, project-scoped, paginated report-summary endpoint. A frontend-only first version may derive candidates from paginated sessions if session summaries expose `reportAvailable`, outcome, timestamps, and counts consistently. It must not download every report to build the list.

### 3.11 Settings and Integrations

Current state: Settings is one large admin-only dialog covering provider, model, execution limits, autonomy, replay, BrowserStack, and team accounts. There is no Integrations route.

What works:

- Existing config read/update and connection tests.
- Masked secret display.
- Admin-only user listing and account creation.
- Non-admin role gating.

Problems:

- A large modal is unsuitable for complex configuration and has weak deep-link/history/accessibility behavior.
- Provider/BrowserStack integrations, execution policy, and user administration are mixed together.
- There is no consistent loading skeleton or save-state pattern.

Proposed split:

- Integrations: AI Provider and BrowserStack cards using existing config/test actions, visible only to roles currently permitted.
- Settings: General execution policy, appearance, and Team Access, preserving current role restrictions.
- Never expose stored secret values. Preserve the existing admin middleware and masked responses.

### 3.12 Project selection

What works:

- `GET /api/projects`, top-bar selection, local persistence, and explicit project creation.
- Project switching reloads runs, workflows, tests, schedules, and metrics.

Problems:

- The project selector competes with settings, identity, theme, and sign-out in a narrow top bar.
- On mobile, the live selector is moved into an overflow menu while account actions are not.

The redesigned shell keeps workspace/project context in the top bar, includes a loading state during cross-page refresh, and prevents accidental cross-project stale content. Embedded mode may supply and lock this context.

### 3.13 Mobile navigation and sign-out defect

Exact defect:

- `app.js` inserts `#auth-identity` and `#auth-signout` after the Settings button inside `.topnav-right`.
- At 480px and below, CSS applies `.topnav-right { display:none }`.
- The overflow implementation moves only project controls and offers New Project and Settings. It neither moves nor duplicates account identity, sign-out, or theme.
- Therefore sign-out and identity are unreachable on phones; non-admin users also lose Settings, making the overflow even less useful.

Correction specification:

- Desktop: persistent sidebar plus top-bar account menu.
- Tablet: collapsible sidebar/rail with the same account menu.
- Mobile: top bar with menu trigger, current context, and account trigger; navigation opens as a focus-trapped drawer.
- The account section always contains identity, role, Sign out, theme, and Settings if authorized.
- Use one centralized logout action and one auth state; do not duplicate tokens or authorization logic.

## 4. Proposed information architecture

Authenticated landing route: `/overview`.

Primary navigation:

1. Overview — `/overview`
2. Runs — `/runs`
3. Test Cases — `/test-cases` (`/tests` alias)
4. Workflows — `/workflows`
5. Findings — `/findings` (`/bugs` alias)
6. Schedules — `/schedules`
7. Reports — `/reports`
8. separator
9. Integrations — `/integrations`
10. Settings — `/settings`

Run detail remains `/runs/:id`. A finding detail and report detail may initially use drawers on their list routes to avoid inventing new backend identity models; stable deep links should be introduced only where identifiers and access checks already support them.

## 5. Overview specification

Top actions:

- Primary `+ New Run` opens the New Run panel/dialog.
- Secondary project selector remains contextual, not part of the creation form.

Cards:

- Active Runs: derive from normalized queued/running/awaiting-input states.
- Runs This Week: owner/project scoped sessions in a seven-day window.
- Open Findings: canonical current findings excluding existing closed/resolved states.
- Critical Issues: canonical current critical findings under the same open policy.
- Pass Rate: existing regression metric, with “No completed regressions” rather than a misleading 0% when unavailable.

Sections:

- Recent Runs: target/title, canonical status, start/update time, duration, pages, actions, findings, report availability.
- Critical Findings: top open critical/high findings with target area and evidence indicator.
- System Health: AI Provider, Worker, Browser, Scheduler. Each is Healthy, Degraded, Unavailable, or Not reported. Never infer subsystem health from `/api/health` alone.

Frontend-only feasibility: metrics, recent sessions, and filtered findings are available. Efficient week-based pagination/facets and global subsystem health are backend gaps.

## 6. New Run specification

Default fields:

- Target URL, required.
- “What should QASE test?”, plain-language task/objectives.
- Testing profile, optional.

Advanced, collapsed:

- Device/viewport request.
- Execution provider only where current role/config allows it.
- Requirements/build context.
- Existing turn budget only if product policy intentionally exposes it.
- Credentials are not collected by default; use the in-run Authentication Required state.

Profile mapping:

| UI profile | Safe current mapping | Decision |
| --- | --- | --- |
| Quick Smoke | No existing `smoke` mission type | Do not ship as a behavioral preset without an approved mapping. A label-only alias to `full_audit` would be misleading. |
| Standard | `type: full_audit` with existing configured defaults | Supported and should be the initial/default profile. |
| Deep QA | No distinct certified mission type or preset contract | Do not ship until a specific existing type/capability/budget mapping is approved and regression-tested. |

Current mission types are `full_audit`, `security`, `ux`, `regression`, `feature_gap`, and `accessibility`. These may remain in Advanced as explicit focus choices. The profile control should initially show only Standard, or show unavailable profiles as planned—not silently alter turn budgets.

Submit one `POST /api/v1/missions` with `targetUrl`, user request mapped to existing prompt/objective fields, `projectId`, `type: full_audit`, and supported constraints. Do not create an empty session first. Route to `/runs/:sessionId` when available and show Queued if the governor has not started a session.

## 7. Core run screen

Header:

- Application host/title and full target URL.
- Canonical status badge.
- Duration, pages, actions, canonical findings.
- Separate report-available indicator.
- Stop only while stoppable; Re-run/Revalidate only when supported and authorized.

Health strip:

- Provider, Worker, Browser, Target using `executionHealth.components` and existing metadata.
- Tooltip/detail exposes a safe reason and next action without credentials or raw stack traces.

Desktop layout:

- Left/main (approximately 60–65%): Live Application / Browser Preview, viewport controls, reconnect/live-state messaging, and persisted screenshot fallback.
- Right/context (approximately 35–40%): Activity, Application Analysis, Evidence, Findings, Report tabs.
- Run list lives in the global Runs page/sidebar/drawer, not as a permanent third column.

Tablet:

- Browser above a tabbed details region or a resizable 55/45 split when width permits.

Mobile:

- Header summary, then Browser and Details as two primary segments.
- Run picker opens a drawer.
- Tables become lists; evidence opens full-screen; all controls remain keyboard/touch reachable.

Empty/live distinctions:

- “Browser has not started” when no historical evidence exists.
- “Live browser disconnected — persisted evidence remains available” after prior work.
- “Browser unavailable” for a blocked dependency.
- “No screenshot evidence captured” only when evidence API confirms none.

## 8. Design system

Visual direction: retain QASE's dark technical visual language, restrained blue accent, monospace flavor for execution facts, and existing light/dark themes. Remove decorative noise and inconsistent one-off overrides.

- Typography: system sans for navigation, forms, and narrative; existing monospace for IDs, URLs, logs, and execution measurements. Body 16px; controls and metadata no smaller than 14px except optional dense desktop telemetry at 12–13px.
- Hierarchy: page title 28–32px, section title 20–24px, card title 16–18px, body 16px, metadata 14px.
- Spacing: 4px base; common gaps 8/12/16/24/32. Page padding 24 desktop, 20 tablet, 16 mobile.
- Cards: one border, one surface, 10–12px radius, 16–20px padding; no nested-card stacks unless hierarchy requires them.
- Status badges: shared semantic tokens for queued, running, input, completed, partial, blocked, failed, cancelled, interrupted. Color is always paired with text/icon.
- Tables: sticky header, row focus/hover, sortable labels, empty row, loading skeleton, responsive list fallback, persistent pagination.
- Forms: visible labels, help/errors associated via ARIA, 44px touch target on mobile, progress and result near the initiating control.
- Loading: skeleton for structural lists/cards; spinner only for a local action; never clear known data during background refresh.
- Empty: explain why empty and provide the single next action.
- Error: state what failed, preserve unaffected content, offer Retry; authorization errors return to login through existing auth handling.
- Motion: only short state transitions and focus/overlay movement; honor reduced motion.

Breakpoints:

- Desktop: `>= 1200px`, expanded sidebar and split run workspace.
- Compact desktop/tablet: `768–1199px`, collapsible rail and adaptive run split/stack.
- Mobile: `< 768px`, drawer navigation, single column, full-width overlays.

## 9. Compatibility and backend gaps

Frontend-only or existing-contract work:

- Shell, navigation, `/bugs` and `/tests` aliases, status presentation, run workspace layout, credential card, finding detail presentation, schedule/table cleanup, responsive account menu, and shared states.
- Overview session/finding/regression content at current data volumes.
- Report truthfulness inside run detail.

Additive backend work to scope separately:

1. Global subsystem health endpoint exposing safe Provider/Worker/Browser/Scheduler states. It must be read-only, owner/role appropriate, and must not trigger connection tests.
2. Paginated report-summary endpoint, unless session summaries are additively expanded with sufficient report metadata.
3. Structured authentication challenge metadata: host/login URL, requested field types, safe prompt, and continuation capability.
4. Server date-range/session summary filtering for efficient “Runs This Week” at scale.
5. Finding facets/taxonomy endpoint if category options cannot remain a static existing taxonomy.
6. Server pagination/filtering for Test Cases and Workflows at large scale.
7. Rich structured scheduler deferred reason in the shared UI error contract, without altering scheduler semantics.

None of these gaps authorizes an API change during the UI audit or early frontend-only slices.

## 10. Likely implementation files

Core existing files: `public/index.html`, `public/styles.css`, `public/router.js`, `public/app.js`, `public/shared.js`, `public/login.html`, `public/login.js`, `public/bugs.js`, `public/tests.js`, `public/workflows.js`, `public/schedules.js`, `public/executionDetail.js`, `public/pipeline.js`, `public/missionIntent.js`.

Likely new frontend modules, introduced only slice-by-slice: `public/shell.js`, `public/overview.js`, `public/newRun.js`, `public/reports.js`, `public/settings.js`, and small reusable view/state helpers. Avoid a parallel frontend or framework migration.

Server files would change only for separately approved additive gaps: `server/index.js`, health/report projection modules, `server/openapiDocument.js`, and corresponding focused tests. Existing certified execution, scheduler, authentication, ownership, provider, and BrowserStack implementations are not redesign targets.
