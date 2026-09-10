# P0-F4 — Multi-user ownership & workspace isolation (ticket #9038)

## Goal
Server-side ownership isolation for missions, sessions, findings, evidence, and
per-session SSE streams. Reuse the existing QASE auth/user model — no second
identity system. Frontend filtering is irrelevant; the boundary must exist in
the API layer.

## Existing model (verified by inspection — do not reinvent)
- `requireApiToken` (server/index.js) sets `request.auth = { kind: 'open' }`
  when QASE_AUTH_MODE=disabled or no apiToken configured, `{ kind:'master' }`
  for bearer/cookie master token, `{ kind:'user', role, userId, email, name }`
  for qase_session logins, and integration HMAC principals set
  `request.integration` (admin='*', integration=one workspaceId).
- `userStore.js`: roles admin|operator|viewer. Admins get full access except
  master-only prefixes (existing rule, preserved).
- Missions already have `workspaceId` + dead `createdByUserId`; sessions have
  no owner field; findings have none. `requireSession()` looks up globally.
- No workspace store exists today — workspaceId on missions is set from the
  integration principal only. So the LEAST invasive ownership boundary is
  **user identity** for user-kind principals, **workspace match** for
  integration principals, admin/master/open unchanged.

## Ownership model (decision)
- New records get `ownerUserId` = authenticated user id (kind 'user'), or
  workspaceId (integration principals), or null (master/open — single-tenant
  legacy records stay visible to master/open, preserving dev behavior).
- Legacy records with `ownerUserId == null` stay readable by everyone: they
  predate ownership, are visible in disabled/open dev mode, and gating them
  behind a user would break every existing suite and the dev workflow. This is
  the least invasive boundary that makes required-auth mode real. Admin/master
  still see everything.
- Enforcement point: a `requireOwnership(kind, request, record)` helper used by
  EVERY resource-touching route (list, read, update, delete, stop, answer,
  SSE). Cross-owner → 404 (not 403) to avoid leaking existence, except where
  an existing convention uses 403 with a code (integration surface).

## Enforcement scope (from endpoint inventory)
Missions: GET /api/missions, GET/PUT/DELETE /api/missions/:id, /link-session,
POST /api/v1/missions (+ start/stop/iterate/revalidate/report/findings/
evidence/decision-trace/loop-status/comparison/validation-comparison),
DELETE mission cascades, POST /api/v1/missions/:id/stop etc.
Sessions: GET /api/sessions, GET/DELETE /api/sessions/:id, /message, /answer,
/credentials, /stop, /detail, report.md, run-pipeline, SSE /events.
Findings: GET /api/findings + detail/mutate/comment/link/status paths.
Evidence: /api/v1/evidence/:id, /stats, /validate, sessions/:id/evidence,
missions/:id/evidence(+chains/coverage/integrity/iterations/compare).
SSE: /api/sessions/:id/events scoped by owner.
Master-only prefixes untouched. Integration workspace semantics untouched.

## Tests (two live users, required-auth mode, no mocks)
New file `tests-real/p0f4-ownership-isolation.test.js`:
1. boot server child with QASE_AUTH_MODE=required + apiToken set
2. create users A (operator) and B (operator) + admin via master token
3. A creates session/mission/finding; B tries list/get/mutate/stop/answer/SSE
4. cross-user → 404; A self-access → 200; admin → 200
5. integration-auth with matching workspace → 200, wrong workspace → 404
6. legacy null-owner records visible to all (documented)
7. run relevant existing suites after.

## Acceptance criteria
- [ ] Every list/read/update/delete/stop/answer/SSE/evidence path enforces ownership
- [ ] Cross-user access → 404 (or existing convention), no existence leak
- [ ] Open/disabled mode behavior unchanged; master/admin unchanged
- [ ] Integration HMAC workspace scoping still passes (d23 suite)
- integration auth tests remain green
- [ ] New p0f4 suite green
- [ ] Existing auth-mode, user-auth, phase16-api, reliability suites green
