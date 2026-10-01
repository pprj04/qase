# Phase 6 · Bug reporting

## Goal
Bugs are first-class records with server-assigned `BUG-XXXX` identifiers, automatically associated with the run that found them, its environment (frozen snapshot) and the honest execution level, persisted in both backends and surfaced in the dashboard.

## Server
- `server/bugService.js` — `BugValidationError` (code `QASE_BUG_INVALID`), validation (title 1–300, description ≤4000, severity ∈ low/medium/high/critical, status ∈ open/in_progress/resolved/wont_fix/reopened, steps ≤50×1000), sequential `BUG-XXXX` numbering, local JSON backend (`.qase/bugs.json`, atomic tmp+rename, mode 0600), facade that:
  - freezes an environment snapshot from the environments service when only an id was passed,
  - auto-associates environmentId / environmentSnapshot / executionLevel / linkedTestCaseId from the linked run when not explicitly provided (explicit input always wins).
- `server/postgres/migrations/020_bugs.sql` — bugs table, CHECK constraints, tenant-unique bug_number, RLS on qase.organization_id/qase.project_id; `server/postgres/bugRepository.js` — parameterized, tenant-scoped.
- `server/bugApi.js` — GET/POST `/api/bugs`, GET/PATCH/DELETE `/api/bugs/:bugNumber`; 422 on `QASE_BUG_INVALID`, 404 unknown; mounted behind the global auth+CSRF middleware in `server/app.js`; wired in `server/serviceFactory.js` for both local and postgres paths.

## UI
- `public/bugView.js` (`createBugView`) — "Bugs" tab in the run-details strip: severity-sorted list of BUG-XXXX rows, expandable to show frozen environment snapshot + `exec:` level, Expected/Actual, description, steps; search / status / severity filters (`bugMatches`); inline status select → `PATCH /api/bugs/:bugNumber` with rollback on failure; "Open linked run" jump when `linkedRunId` is set.
- `public/app.js` — `createBugReport` quick action POSTs the freshest run with findings to `/api/bugs` (markdown fallback only if creation is unavailable); `refreshBugs()` on boot and after creation.

## Acceptance criteria
- [x] POST /api/bugs assigns sequential BUG-XXXX numbers, persists, returns 201
- [x] Auto environment association from linked run incl. frozen snapshot and honest execution level (never fabricated)
- [x] Explicit environment fields are not overwritten
- [x] Validation failures → 422 `{error, code:"QASE_BUG_INVALID"}`; unknown bug → 404
- [x] Writes require session + CSRF (401/403 otherwise)
- [x] Postgres path tenant-isolated via RLS + parameterized SQL
- [x] Bugs tab: list, filters, expand, inline status change, linked-run jump, XSS-safe (textContent only)
- [x] Unit tests: server/bugService.test.js (7), public/bugView.test.js (5); full suite green

## Verification log (2026-09-29)
- Live API: 201/422/404/204 all as specified; reviewer PASS on all criteria; tester 9/9 PASS on the preview URL.
- Known limitation (noted by reviewer): repeated "Report bug" clicks create one bug per click — no duplicate guard (same posture as findings creation). Optional future improvement, not in scope.
