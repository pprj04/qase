# Phase 11 · Controlled pilot (#12963)

## Goal
Make the pilot controllable: instead of "open registration to everyone or
create nothing", the operator admits pilot users via single-use invite codes,
gets admin visibility into pilot feedback and usage, and pilot users see an
honest beta notice. This is the minimum operational surface to hand QASE to a
handful of invited beta users.

## Changes

### 1. Invite-code registration (server)
- New `server/invites.js`: invite store in `.qase/invites.json` (atomic,
  mode 0600, same conventions as auth store). Invite: `{code, note,
  createdAt, createdBy, usedBy?, usedAt?, expiresAt}`.
  - Code format: `qase-<24+ chars base32>` (crockford), constant-time compare,
    single-use, optional expiry (default 14 days).
- `POST /api/auth/invites` — create invite. Authenticated, operator-only
  (see #3 role gate). Rate-limited.
- Registration path (`app.js` register endpoint): when registration is
  otherwise closed (production, `QASE_OPEN_REGISTRATION != 'true'`), a valid
  unused `inviteCode` in the body admits the request; the invite is consumed
  atomically. Open-registration behavior unchanged otherwise. Invalid/expired
  code → same 403 shape as today (no enumeration oracle).
- `scripts/pilot-invite.mjs` — operator CLI to create/list invites via the
  API (used from the dev container / pod shell), so admitting a user does not
  require opening registration.

### 2. Pilot analytics surface
- Add `cohort` dimension (value `'pilot'` when the account was created via
  invite during an active pilot) to `run_created`, `run_finished`, and
  `feedback` events (dimension whitelist extended, still no PII).
- `GET /api/analytics/feedback` — operator-only: lists feedback
  (rating, note, mode, ts) across sessions for pilot review. Notes are
  operator-visible by design (user typed them into the product).

### 3. Operator role gate
- Users created via invite registration get `role: 'pilot'` instead of
  `'developer'`. Existing role field honored; no schema change.
- New middleware `requireOperator` (role `owner`/`admin`/`developer`
  allowed — on this single-tenant instance the bootstrap developer IS the
  operator; pilot users are excluded) guarding the two new endpoints.
- Bootstrap owner (QASE_BOOTSTRAP_*) remains the instance owner.

### 4. Pilot notice (UI)
- Small dismissible banner on first visit: "Qase pilot — you're testing a
  beta build. Runs may be slower and reports may contain errors. Your
  thumbs feedback goes straight to the team." Stored in localStorage.
  Shown when `GET /api/pilot-status` returns `{pilot: true}` (env-driven
  `QASE_PILOT_MODE=true`).

### 5. Ops
- `.env.example`: `QASE_PILOT_MODE`, invite notes; runbook §5 decisions
  table updated (pilot row: invite-gated registration, metrics token set).
- `QASE_METRICS_TOKEN` set for the dev container env (via backend env keys)
  so `/metrics` is exercised in pilot shape before prod.

## Out of scope
- Per-user run/spend quotas (single pod, handful of users — revisit at launch).
- Account status management UI (manual JSON edit remains the fallback).
- Cohort A/B tooling.

## Acceptance criteria
- [ ] Registration with a valid invite succeeds while open registration is closed.
- [ ] Reused / expired / absent invite → 403, no account created, no oracle.
- [ ] `POST /api/auth/invites` + `GET /api/analytics/feedback` reject pilot-role users.
- [ ] Invite store is atomic and 0600 like the auth store.
- [ ] Cohort dimension present on pilot events; analytics summary shows it.
- [ ] Pilot banner appears once for pilot users; localStorage dismissal sticks.
- [ ] CLI creates and lists invites.
- [ ] Unit + integration tests green; full verify green.
- [ ] Runbook + .env.example updated.
