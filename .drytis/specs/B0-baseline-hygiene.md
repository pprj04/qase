# BUILD B0 — Baseline, Hygiene & Operational Safety

Goal: establish a trustworthy baseline (architecture, config authority, runtime health, regression status) and fix ONLY confirmed B0-class defects. No B1/B2/B3 scope.

## Scope
- Phase 0: read-only repo audit → feature truth table (IMPLEMENTED+VERIFIED / IMPLEMENTED+NOT VERIFIED / PARTIAL / DOCUMENTATION ONLY / NOT IMPLEMENTED)
- Phase 1: reproduce & fix confirmed B0 UI defects:
  - [ ] Export endpoints building URLs without `/api` prefix → 404 (public/app.js handleExport)
  - [ ] Tests-page "Run all" hardcoded concurrency:3 / retries:0 bypassing config (public/tests.js)
  - [ ] Settings UI: only an obvious confirmed defect blocking existing config
- Phase 2: configuration authority audit (env vs stored .qase/config.json vs defaults); document ACTUAL precedence; classify discrepancies; minimal safe correction only if dangerous (maxTurns 500 vs env 120; replay pool 20 vs env 3 w/ OOM note)
- Phase 3: runtime/restart baseline (production server, procmgr services, preview 200, restart keeps config + .qase data, no corruption)
- Phase 4: lightweight secret hygiene scan (hardcoded secrets, credential logging, API echoes) — document only, no security architecture
- Phase 5: one controlled smoke mission vs https://new.drytis.com (small maxTurns) verifying mission/session/findings/evidence persistence + retrieval
- Phase 6: regression suites (smallest relevant first, broader if practical); distinguish B0-caused vs pre-existing failures
- Phase 7: docs/B0-BASELINE-REPORT.md with required sections
- Phase 8: acceptance checklist

## Acceptance criteria
- [ ] Architecture documented from actual code; old docs separated from verified implementation
- [ ] Each B0 fix: reproduced → minimal fix → regression test → verified
- [ ] Config precedence documented; dangerous discrepancies fixed or explicitly documented
- [ ] Production runtime starts; restart preserves config/state; no new corruption
- [ ] Smoke mission vs new.drytis.com completes; session/findings/evidence persisted and retrievable
- [ ] No new regression introduced (pre-existing failures documented as pre-existing)
- [ ] BrowserStack trust behavior intact (browserstack-trust suite green)
- [ ] Security hygiene audit completed (documentation only)
- [ ] B0 report created; changes strictly within B0 scope

## Out of scope (STOP rule)
Integration auth, workspace/project ACL, mission idempotency keys, webhook signing, correlation IDs, OpenAPI, autonomy wiring (resolveAction/testContext/enrichment), turn governor, LLM roles, BrowserStack redesign, SSRF changes, infra (PG/Redis/k8s/queues).
