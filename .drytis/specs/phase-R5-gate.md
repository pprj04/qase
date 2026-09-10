# Phase R5 — Full-suite gate (P0 acceptance)

Run order (server must be up; benchmarks helper may stay up; use QASE_BASE_URL=http://localhost:5173 override — documented env collision with the LLM endpoint):

1. `npm run test:reliability` (new suite — must be green first)
2. `npm run test:gate` (core + contract + truthfulness + e2e — the 1,236-test baseline; zero new failures vs baseline; known/KNOWN findings never gate)
3. OpenAPI suites: `npm run test:openapi`, pulse-openapi-document, pulse-openapi-api, openapi-docs-parity
4. Governor + state + persistence units: mission-governor.test.js, m1-p4.3-state, m1-p4.4-persistence, phase1-failure-injection, phase9-closure-browser-recovery, phase9.3-resource-lifecycle-v2, session-timeout, b1-crash-restore, c2-closeout-failure-modes

## Gate criteria
- New reliability suite: 100% pass
- test:gate: pass (blocking categories), no regressions vs the recorded baseline
- All openapi suites green (spec untouched but protected-file git-clean check must hold)
- No file left uncommitted (c4 gate asserts openapiDocument.js git-clean; commit each phase as it lands)

## Commit discipline
One commit per phase (R1…R5) with `Tests:` sections. Push only on user instruction.

## HARD GATE
Fix-validation work (next milestone) does NOT start until every item above is green and committed.

**Acceptance**: gate report with per-suite pass counts; commits on main; ticket moved for user review.
