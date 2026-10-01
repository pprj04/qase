# Browser test — React UI Phase 2 (ticket #14024), /app-react/ runs sidebar

Tested 2026-09-30. All checks PASS.

- Runs sidebar fetches real data from GET /api/sessions (browser profile is authenticated): 29 run rows rendered — title hostname, relative time ("2h ago".."14d ago"), duration (⏱ or ⏸ for paused with tooltip "Paused — resumes from this duration"), finding-count badge (number), token badge with tooltip "N prompt / N completion tokens", progress "x/y" + progressbar (aria-label "Plan progress x of y steps").
- Row click sets aria-current="true" on exactly one row; clicking another row moves active state.
- Hover row reveals "Delete run <host>" × button; click → inline confirm "Delete this run? [Delete] [Keep]"; Keep dismisses confirm, row remains.
- Status bar: conn-dot (7px, class conn-dot) rgb(34,197,94) green, text "connected" (briefly "connecting…" on load). No "N runs in progress" prefix observed while signed in.
- Theme toggle still works both directions; dark persists from prior session.
- Console: only known ignorable /favicon.ico 404. No JS errors.
