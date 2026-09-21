# Fix reported `/login` 404

Ticket: #10963 Fix reported 404 page not found

## Scope

Expose the existing Qase entry screen at `/login`. Keep the current `/` entry point and all API, demo, authentication, and unknown-route behavior unchanged.

## Acceptance criteria

- [x] `GET /login` returns HTTP 200 and the existing Qase entry document.
- [x] `HEAD /login` returns HTTP 200.
- [x] `/api/*` missing routes continue to return the existing JSON 404 contract.
- [x] Unrelated unknown browser routes continue to return 404; no broad SPA fallback is introduced.
- [x] Existing automated tests remain green.
