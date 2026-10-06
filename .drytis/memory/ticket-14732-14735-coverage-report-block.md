# Ticket #14732/#14735 — coverage persistence in reports (tested 2026-10-05)

Run started via New QA Run dialog with Deselect All + only 3 options checked (Desktop layout, UI consistency, Navigation & Links), target https://qase.dev/.

- Chat kickoff message correctly listed exactly those 3 focus areas, and the instruction **survived page refresh** (re-selected run from list, same first user message). Persistence of the config → chat prompt: PASS.
- Run completed (Blocked verdict, qase.dev 525 outage — expected, fine).
- **Report tab: NO "What was tested — selected coverage" section anywhere** — report shows only Summary / Test plan / Covered / Not covered / Recommendations. FAIL.
- **Downloaded qase-report.md: no "## What was tested — selected coverage" heading, no ✓/✗ coverage lines.** FAIL.
- Legacy run (9/29/2026): correctly shows no such section (that part passes trivially).
- Console: only the usual pre-login 401 /api/auth/me; no JS errors.

Conclusion: the report-side "What was tested" block (UI + .md export) appears NOT IMPLEMENTED / not deployed, even though the selected coverage is persisted and reflected in the kickoff message.