# Phase 3 auth-gate browser tests — /app-react/ (ticket #14025)

## 2026-09-30 run 3: login-in-place refetch — FIXED ✅
- Fix applied: session store now refetches GET /api/sessions when auth flips to signed-in.
- Verified: Sign out → gate → sign in (accounts[0] bugtracker-test@drytis.example) → WITHOUT any reload:
  - Network log: POST /api/auth/login 200 → immediately GET /api/sessions 200.
  - Gate absent from DOM, footer avatar "B" + "Bug Tracker Test" + "Sign out".
  - Runs sidebar repopulated 27 run rows in place.
  - No reload confirmed via performance.getEntriesByType('resource') still containing the /api/auth/login entry after login (same document).
- Console errors: only /favicon.ico 404 (known/ignorable) + expected pre-login 401s (/api/sessions, /api/auth/me while signed out). No JS exceptions.
- Status bar "connecting…" until a run row is clicked is BASELINE behavior (SSE per active session), not a login defect — verified on clean reload in run 2.

## History
- Run 1: FAIL — login 200 but gate stayed visible; root cause: CSP blocked inline theme bootstrap + auth store never flipped to signed-in. (Fixed via external theme-bootstrap.js + store flip.)
- Run 2: FAIL — gate cleared in place but no GET /api/sessions after login → runs list empty until manual reload.
- Run 3: PASS — full in-place restore: gate clears, footer updates, run list repopulates. Phase 3 login flow complete.
