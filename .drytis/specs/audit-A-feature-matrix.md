# Audit A — QASE feature matrix: full self-test + previously-tested-targets inventory

## Goal
Produce a verified WORKS / BROKEN / PARTIAL table for EVERY user-facing and API feature of Qase, plus a detailed inventory of previously tested applications/targets with their historical results. Evidence-backed, no guessing — every row must cite a live check (HTTP call, UI action, or store read).

## Feature inventory to verify (from routes + stores + UI)
1. **Missions** — create (API + UI), queue/governor behavior, stop (queued/created/running branches), detail view, evidence, reports. Status flow created→queued→running→completed/failed/aborted/cancelled.
2. **Sessions** — list (note: dev store wiped 2026-09-03 — history legitimately empty; mark as "degraded by incident, not product bug"), create, stop, awaiting_input expiry (R2-A), transcript/activity SSE.
3. **Findings** — list/filter/pagination, stats endpoint, grouped categories, dedup (canonical vs duplicate count), severity spread, evidence links.
4. **Workflows** — extracted workflows from missions, replay.
5. **Test cases** — 854 cases, generation pipeline, linkage to findings, JUnit/smoke runs.
6. **Regression** — runs history (200 actual), schedules create/list/run (cron 60s tick), latest-run pass rate.
7. **Fix-validation** — A/B runs (:9906 buggy vs :9907 fixed), statuses (VERIFIED_FIXED/STILL_BROKEN/REGRESSED/UNABLE_TO_VERIFY), knowledge updates.
8. **Knowledge** — store entries (416), search/apply.
9. **Reports/exports** — markdown, GitHub, Jira, Linear, JUnit export endpoints.
10. **Integration API** — /api/v1/integration/* HMAC (key create via UI/API, signed request 200, bad signature 401, replay 401, admin op 403).
11. **/api/v2 analytics** — spot-check 5+ of the 32 GETs incl. pagination + one 404 case.
12. **OpenAPI** — /openapi.json serves, title "Qase API", 47 ops, hmacAuth present.
13. **Auth** — QASE_AUTH_MODE required: login gate works on UI, token API works; demo site reachable.
14. **Targets** — demo site /demo, benchmark apps 9901–9907 (incl. ContactVault known defect), targetGuard port allowlist behavior (blocked port rejected with clear error).

## Previously-tested-targets inventory (deliverable table)
From .qase stores (missions.json, findings.json, fix-validations.json, regression-runs.json, replay-runs.json): per target URL — missions run, findings by severity/category, fix-validation coverage, regression runs, last tested. Group: /demo, localhost:99xx benchmarks, external https targets. Include the known findingIntelligence AUTHENTICATION drift (classifier 490 vs true 386) as a data-quality row.

## Method
- Live server at http://localhost:5173 (QASE_API_TOKEN + HMAC key in .env/config). UI via Playwright screenshots of each route.
- Store reads via node one-liners (read-only; NEVER write .qase).
- Full suite already green (130 tests battery + 1,236 gate from earlier phases — cite, don't rerun the 34-min gate unless a feature row contradicts it).

## Acceptance criteria (observable)
- [ ] Table row for every numbered feature above with WORKS/PARTIAL/BROKEN + evidence (HTTP status + endpoint, or screenshot path, or store read output)
- [ ] Previously-tested-targets table with per-target counts and last-tested dates
- [ ] Any BROKEN row has a reproduction snippet
- [ ] Known dashboard discrepancies re-checked and listed with current status

## Out of scope
Fixing anything found (findings become tickets/notes for the user to prioritize). No production code changes.
