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

- [x] `GET /api/health` returns 200 `{status:'ok', service:'qase', ...}` without credentials
- [x] Route mounted before the API auth gate (no 401, no fall-through to 404)
- [x] Response is `no-store`, contains no run/session/user data
- [x] Unknown `/api/*` routes still gated (401) or 404 — the catch-all does not own /health
- [x] Unit test added and passing; full suite green (505 tests, 0 fail)
- [x] Deployed to production and verified: on the pod (localhost:5173) and publicly via the platform URL
- [x] Review package updated (/workspace/.drytis/reviews/ticket-10964.json)

## Verification (2026-09-15, rework round)

- Pod: HEAD dc66ab0, app RUNNING, `/api/health` → 200 status payload, `/` → 200, unknown `/api/*` unauthenticated → 401.
- Public: https://prod-qase-2-1-tawpkk.drytis.dev/api/health → 200 status payload; platform URL root → 200.
- Domain: https://qase.drytis.com/health → 200 (Caddy health block), but `/` and `/api/health` → edge 502 — platform-side custom-domain routing missing (`list_production_custom_domains` → `[]`); documented separately, not application code.
