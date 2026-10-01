# Phase 1 — Security test catalog, availability metadata & API validation

Goal: extend the QA test catalog with a "Security testing" category (6 checks), an
availability model for not-implemented checks, and server-side validation that keeps
security selections gated by explicit authorization.

## Catalog (`server/qaTestCatalog.data.js`)
- Add `category: 'standard'` to the existing 8 tests (backward-compatible field).
- Add 6 security entries, `category: 'security'`, each `{id, title, description, focus, availability}`:
  - `security_authentication` — Authentication: login, logout, invalid credentials, session handling. **available**
  - `security_authorization` — Permissions & authorization: role restrictions, access to another user's protected data. **available**
  - `security_input_validation` — Malformed, unexpected, boundary-value inputs. **available**
  - `security_sql_injection` — Verify inputs cannot change database-query behavior, judged from browser-observable responses only (errors, behavior differences). **available, authorized-env only**
  - `security_mitm` — Man-in-the-middle scenarios. **unavailable** — no agreed, configured scenario exists; label reason verbatim: "Not implemented — requires an agreed, configured MITM scenario."
  - `security_dos` — Denial-of-service scenarios. **unavailable** — "Not implemented — requires an agreed, configured DoS scenario."
- `focus` text for available checks encodes the check's method + evidence expectations (researcher's per-check focus guidance).
- Availability shape: `{ available: true }` or `{ available: false, reason: '…' }`. Unavailable ids are NEVER valid in a run selection.
- Bump `version` (e.g. `2026.10.1`).

## API surface
- `publicQaTestCatalog()` (server/qaTestCatalog.js) exposes `id, title, description, focus, category, availability` — the launcher needs everything, no internals.
- `/api/qa/catalog` unchanged route, new payload fields.
- `validateQaSelectedTests` (server/appQaSelection.js): accepts security ids; **rejects unavailable ids** (clear message naming the reason); MAX stays 32 (14 total).
- `POST /api/sessions` accepts `securityAuthorization: { confirmed: boolean, scope?, notes? }`. If any `security_*` id is selected and `confirmed !== true` → 400 with an actionable message. Persist on session (store.js + postgres runRepository, same pattern as `selectedTests`).

## Acceptance criteria
- [ ] `/api/qa/catalog` returns 14 tests with `category` and `availability`; MITM and DoS carry `available: false` plus their reasons.
- [ ] A run selecting `security_authentication` without `securityAuthorization.confirmed` is rejected with 400; with confirmation it is created and the session persists the security selection.
- [ ] Selecting `security_mitm` or `security_dos` is rejected server-side regardless of authorization.
- [ ] Existing behavior unchanged: no `selectedTests` → full standard coverage; standard-only selections need no authorization.

## Tests
- Unit: catalog shape/version bump; validation (valid security subset, unavailable id, missing authorization, confirmed + persisted).
- Integration: POST /api/sessions matrix (standard-only, security + auth, security − auth, unavailable id).
- Edge: duplicate security ids; oversized; `securityAuthorization` present without security tests (ignored).

## Edge cases
- Older clients sending only standard ids — unchanged behavior.
- Postgres round-trip of `securityAuthorization` (nullable, absent for standard runs).
