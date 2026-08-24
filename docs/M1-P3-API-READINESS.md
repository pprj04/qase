# M1-P3 — API READINESS (Phase 4 deliverable)

Scope: routes classified **KEEP** or **EXTERNAL CONTRACT** in
`docs/M1-P2-API-ROUTE-CLASSIFICATION.md`. Each is graded READY / NEEDS CHANGE /
DEPRECATED LATER against nine checks: authentication, status consistency,
request validation, response shape, error shape, pagination, ID handling,
deterministic errors, no secret leakage. Evidence comes from the M1-P1 route
inventory, the live server, and the M1-P2 contract suite.

## Fix status inherited from M1-P3 Phase 3 (this phase)

| Fix | Route(s) affected | Change |
|---|---|---|
| P0-5 | all responses | `setAuthCookie` no longer auto-sets `qase_token` on anonymous GETs — the mutation token is no longer handed to anonymous page loads |
| P0-6 | `PATCH /api/findings/:id/status` | now gated by `requireApiToken` (was the only open mutation) |
| P1-1/P1-2 | `GET /api/v1/missions/:id/evidence`, `GET /api/v1/sessions/:id/evidence`, `GET /api/v1/sessions/:id/observations` | `total` now computed in the same pass as the page (no second unbounded query; total no longer equals page size) |

## Grade summary

| Domain | KEEP/EXT | READY | NEEDS CHANGE | DEPRECATED LATER |
|---|---|---|---|---|
| health/stats | 3 | 3 | 0 | 0 |
| config | 5 | 5 | 0 | 0 |
| test-cases | 4 | 4 | 0 | 0 |
| workflows | 3 | 3 | 0 | 0 |
| schedules | 4 | 4 | 0 | 0 |
| missions v1 | 21 | 16 | 5 | 0 |
| findings | 17 | 14 | 3 (config-adjacent: status PATCH auth was fixed; export prefix fixed in M1-P2) | 0 |

*(table continues in per-route detail below)*

## Per-route detail — READY (representative, contract-frozen)

- `GET /api/health` — 200 `{status, uptime…}`; deterministic; no auth (intentional).
- `GET /api/sessions` — list shape pinned; open GET is the documented single-tenant posture (S1 residual, tracked).
- `GET /api/v1/missions/:id/report` — 200/404 shape frozen.
- `GET /api/test-cases`, `GET /api/workflows`, `GET /api/schedules` — 200 list shapes + create→delete round-trips.
- `GET /api/config/*` — redacted view never leaks `apiKey`/`apiToken`/`browserstackPassword` material.
- `GET /api/v1/fix-validations/*` — lifecycle states derivations pinned.
- `GET /api/v1/evidence/*` — list/detail shapes pinned.
- `GET /api/artifacts/*` — serves files; path traversal rejected (S6 stays blocked).

## Per-route detail — NEEDS CHANGE (M1-P4+ scope)

1. **`GET /api/config` leaks `browserstackUser` in cleartext** (config.js:217) — P1.
   Not fixed here (config.js is on the do-not-touch list unless P0). → M1-P4.
2. **`createMission` accepts caller-supplied `data.id`** (missions.js:103) — repeated id
   silently overwrites an existing mission record. → M1-P4 (ID generation server-side).
3. **~8 sites leak `error.message` internals** in 500 bodies — inconsistent error shape.
   → M1-P4 (unify on `{ error: string, code?: string }`).
4. **Idempotency-Key honored only on revalidate** — create/report lack it. Documented
   as PLANNED in the lifecycle contract; not a route defect per se.
5. **`GET /api/sessions` and mission list endpoints have no pagination** — full payload
   every time (sessions.json is 33MB on disk; list is pruned to 50 in memory). → M1-P4.

## Non-goals verified intact

- No route was removed or re-shaped beyond the three P0/P1 fixes above.
- Protected suites (phase18, browserstack-trust, execution-provenance, device-*) not touched.
