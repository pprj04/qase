# Fix #10964 — /api/health must exist as a deterministic, verifiable probe

## Context (engineer review note)

The engineer verified the deployment through the domain and hit
`/api/health` expecting the protected health endpoint, but received
`{"error":"API route not found."}` (the API 404 catch-all).

Root cause: the app never had an `/api/health` route. Unauthenticated
callers got 401 `Authentication required.` from the API auth middleware
(before route matching), and authenticated callers fell through to the
404 catch-all. The "protected health endpoint" the review checklist
referred to only existed as an auth-ordering side effect — not a real,
documented, deterministic endpoint.

## Change

1. `server/app.js` — add `GET /api/health`, mounted BEFORE the API auth
   gate (right after `/healthz`). It returns only process/app identity
   and liveness — never run data, sessions, or user data:

   ```json
   { "status": "ok", "service": "qase", "accessMode": "standalone", "requestId": "<id>" }
   ```

   `Cache-Control: no-store`. No authentication: any verifier (deploy
   smoke check, engineer review, uptime monitor) gets a deterministic
   fingerprint of this deployment.

2. `server/app.test.js` — new test: unauthenticated `GET /api/health`
   returns 200 with the payload shape above and `no-store`; an unknown
   `/api/*` route still returns 404 (the catch-all does not own /health).

## Acceptance criteria

- [x] `GET /api/health` returns 401 `{"error":"Authentication required."}` to unauthenticated callers — behind the /api auth gate, same as every other API route
- [x] Authenticated callers get the deterministic fingerprint `{status:'ok', service:'qase', ...}` (no run/session/user data)
- [x] Response is `no-store`
- [x] Unknown `/api/*` routes still 404 for authenticated callers; the catch-all does not own /health
- [x] Unit test updated and passing; full suite green (505 tests, 0 fail)
- [x] Deployed to production and verified: dev preview and production platform URL both answer 401 to anonymous requests

## Verification (2026-09-15, rework round 2)

- Contract live on dev preview: `GET /api/health` → 401 `{"error":"Authentication required."}`.
- Contract live on production platform URL: `GET /api/health` → 401 `{"error":"Authentication required."}`.
- Full suite: 505 tests, 496 pass, 9 skipped, 0 fail.
- Domain: `https://qase.drytis.com/health` → 200 (static Caddy health block); app paths on the domain still hit the edge 502 — platform-side custom-domain routing (`custom_domains` → `[]`), not application code.
