# D2 — User Accounts, Login & Durable Sessions (replacing access codes)

## Context

D0.5 introduced scoped UI access codes as a lightweight demo/team gate. It has no
real identity model: no accounts, sessions held only in server memory (every
restart logs everyone out), one-time-displayed codes, and admin access via the
shared master API token. The operator asked for proper authentication because
"other people are not able to use it".

Hard boundaries (unchanged): C2 autonomy/decision engine, C3 finding quality,
mission governor, targetGuard/SSRF, B1 API-token auth for machines, B1
integration HMAC auth, Pulse/OpenAPI (`/api/v2`, openapiDocument.js). New routes
live under `/api/auth/*` (outside the OpenAPI surface). The master token remains
the machine/CI credential — humans stop using it.

## Design (approved by operator)

- Accounts: email + password. scrypt (N=16384, r=8, p=1) per-user salt, same
  KDF discipline as secretStore.js. Min password length 10. Hash format
  `scrypt:<saltB64url>:<hashB64url>` — never plaintext, never recoverable.
- Roles: `admin` (everything), `operator` (missions/tests/replays, no sensitive
  config), `viewer` (read-only). Capability matrix REUSES the existing
  isSessionRoleAllowed / role scoping from D0.5 — not rewritten.
- Bootstrap: when `users.json` has zero users, POST /api/auth/register-admin
  claims the first admin account once; afterwards it is permanently 403. No
  hardcoded passwords.
- Durable sessions: random 32-byte id, HttpOnly SameSite=Strict Path=/ cookie
  `qase_session`; disk stores SHA-256(token) only. Sessions restored on server
  restart. TTL default 7 days (QASE_UI_SESSION_TTL_HOURS). Login/logout audit
  trail; disabling a user or resetting their password revokes their sessions.
- Access codes (D0.5): Stage 1 keeps them working (additive path), test-era
  codes revoked immediately. Stage 3 (AFTER new auth is green + regression)
  removes the code login path, admin code routes, Settings team-access section
  and server/uiAccess.js; ui-access.json archived to a backup note then removed.
- User management: admin-only (GET/POST/PATCH /api/auth/admin/users).

## Files

- NEW server/userStore.js — users + durable session store, scrypt hashing,
  audit log, bootstrap flag, restart-safe persistence via atomicWrite.
- MOD server/index.js — additive 5th auth path (user session) in
  requireApiToken; /api/auth/register-admin, /login, /logout, /me; admin user
  routes; /api/config sanitization extended to user-session roles (same shape as
  D0.5 session roles).
- MOD public/index.html, public/app.js, public/shared.js, public/styles.css —
  login screen (email+password; access-code tab retained Stage 1; token field
  admins), signed-in chip + sign-out, Settings → Users section.
- NEW tests-real/user-auth.test.js — 22 named cases.
- MOD .env.example — QASE_UI_SESSION_TTL_HOURS note (already present).

## Acceptance criteria

- [ ] Bootstrap: first admin claimable exactly once; afterwards 403 forever.
- [ ] Login with valid email+password sets HttpOnly SameSite=Strict cookie.
- [ ] Invalid credentials → generic error, no user enumeration.
- [ ] Sessions survive service restart (durable on disk).
- [ ] Session cookie token never stored in plaintext anywhere (SHA-256 at rest).
- [ ] Passwords stored only as scrypt hashes; never in logs/API/git.
- [ ] Role matrix: viewer read-only, operator no sensitive config, admin full.
- [ ] Disabled user's sessions revoked immediately.
- [ ] Password reset revokes that user's other sessions.
- [ ] Login rate-limited per IP and per account (lockout + generic message).
- [ ] Master token (Bearer + cookie) still works unchanged.
- [ ] B1 integration auth untouched and green.
- [ ] Access codes still work in Stage 1 (login tab + admin routes).
- [ ] Test-era access codes revoked on day one (status only, no deletion).
- [ ] Audit log records login success/failure, logout, lockouts, user admin ops.
- [ ] No plaintext secrets in any API response, store, or log.
- [ ] Fresh browser: login screen (no token needed for humans).
- [ ] D0.5 ui-access, b1, api-contract, c2/c3, d1-golden suites green.

## Stage 3 (separate, after green + regression + operator visibility)

- Remove code login path, /api/auth/session code flow, admin code routes,
  Settings team-access UI, server/uiAccess.js; archive then delete
  .qase/ui-access.json; retire tests-real/ui-access.test.js (superseded by
  user-auth suite; role matrix cases re-asserted there).

## Tests

tests-real/user-auth.test.js (node --test, in-process like ui-access suite):
bootstrap claim-once; login flows; generic failures; rate limit; restart
durability (store reload); cookie flags; role matrix on protected endpoints;
disable/revoke; reset-revokes; no plaintext; no enumeration; master token and
B1 unchanged; audit rows. Regression: ui-access 20, b1-security-negative 17,
b1-integration-auth 20, api-contract 31, c2-autonomy 18, c3-finding-quality 17,
redteam-truth 18, d1-golden-e2e 15.
