# QASE_AUTH_MODE — Configurable Authentication

## Goal
Deployment-level authentication switch for QASE, controlled by `QASE_AUTH_MODE`:
- `required` (default) — current behavior, byte-identical.
- `disabled` — development/integration mode: UI opens with no login, no API-key prompt; `/api/v1/*`, `/api/v2/*`, `/api/config` (read), sessions, missions, findings, evidence all work unauthenticated.

## Constraints
- No deletion of authentication code — flipping back to `required` restores exact current enforcement.
- No hardcoded API keys, no fake auth responses, no mock missions/findings.
- BrowserStack credential storage/handling untouched (it is config-store-level, not user-auth-coupled).

## Server changes (server/index.js)
1. `const AUTH_MODE_DISABLED = process.env.QASE_AUTH_MODE === 'disabled';` (boot-time, env-only)
2. `requireApiToken`: after the existing no-token open-access branch, if `AUTH_MODE_DISABLED` → `request.auth = { kind: 'open' }; return next();`
3. `GET /api/auth/me`: in disabled mode return `{ kind: 'open', mode: 'disabled' }` (200) instead of 401, so the SPA never arms the auth gate or shows a login chip.

## Frontend
No code change: the gate arms only when boot `GET /api/config` fails. Verified live in disabled mode.

## Env
Backend env key `QASE_AUTH_MODE` (static, default `required`); development-scope override `disabled`. Production keeps `required`.

## Tests (tests-real/auth-mode.test.js)
Spawn isolated child servers on free ports, one per mode:
- disabled: GET / → 200; GET /api/config anon → 200; GET /api/auth/me → `{kind:'open'}`; POST /api/v1/missions anon → not 401/403; POST /api/v1/missions/:id/start → not 401/403; GET /api/findings anon → 200; GET /api/v2/health → 200.
- required (QASE_API_TOKEN set): anon /api/config → 401; wrong bearer → 401; anon mission create → 401.
- legacy: no token configured → open access unchanged.
- Regression: user-auth, security, d23-browserstack-probe-auth suites green.

## Acceptance criteria
- [ ] `QASE_AUTH_MODE=disabled`: UI loads with no login and no API-key prompt
- [ ] Anonymous mission create + start work; findings/evidence retrievable
- [ ] Agent/browser execution functions (mission lifecycle) unaffected
- [ ] `QASE_AUTH_MODE=required` (or unset): all existing 401/403 behavior unchanged
- [ ] No repeated key prompts in disabled mode
- [ ] Suites green; live smoke verified after restart (restart only after all changes saved)
