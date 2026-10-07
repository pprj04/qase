# Ticket #15270 — "Start run is not working" diagnosis (2026-10-07)

## Outcome: Start QA run WORKS. The report was the security gate UX.

Root cause of the user report: with Security Testing coverage preselected by default, the first
Start click fails form validation on the authorization checkbox (`#qa-security-authorized`-area,
public/index.html) which sat at the bottom of the modal below the fold. The alert text rendered
just below the fold too — the button looked dead.

Fix (public/app.js, securityAuthorized 'invalid' listener ~:5508): on failed submit, scroll the
checkbox into view (block:center, smooth) and focus it; alert message unchanged. No layout/styling
change. Verified by tester: checkbox rect fully in 720px viewport + focused; second click starts
the run ("Planned 2 · In flight 2").

## Environment noise during this ticket (NOT app bugs)
- Severe recurring container fork exhaustion ("fork: Resource temporarily unavailable") — needed
  TWO restart_container calls within the hour. Preview goes 502 during these windows.
- The SSE endpoint errors the tester saw (`/api/sessions/<id>/events` ERR_INCOMPLETE_CHUNKED_ENCODING
  + 502) coincided with one of those restarts — stream cut by restart, run dialog kept updating via
  /api/matrix-runs/:id polling (200s in service log). No code change needed.
- Board quirks this session: two phantom tickets created (#15166/#15167 area, move→422, list shows
  only first 100 Done); the real ticket ended up #15270 and was closed Done.

## Pre-existing unrelated defects noted (not fixed)
- 4 pre-login 401 console errors on the landing page (/api/environments ×2, /api/device-runtime/devices,
  /api/auth/me fired before login) — cosmetic.

Fix is uncommitted on NIHARIKA along with the rest of today's work.