# D1 — Golden End-to-End Testing Loop (Milestone 1 closure)

Status: Phase 2 approved 2026-08-30. Source of truth: D1 Phase 1 audit (same session).
Protected boundaries (unchanged): C3 decision engine, C3 finding-quality rules, C2
autonomy, mission budget authority/governor, targetGuard/SSRF, B1 authentication,
B1 integration auth, Pulse/OpenAPI, D0.5 team access, BrowserStack.

## Goal

Prove, with live evidence (no mocked agent/browser/LLM), the complete chain:

Operator → authenticated access → mission create → governor dispatch → real LLM agent
→ real browser → real target interaction → evidence (linked session+mission+iteration)
→ findings ONLY when justified → workflow capture → test-case generation → test-case
persistence → generated-test replay → truthful statuses → refresh/reopen → service
restart persistence.

## Proven facts from Phase 1 (basis for expectations)

- Mission chain, evidence linkage, truthful statuses, D0.5 roles, targetGuard pre-flight,
  deterministic close-out: WORKING live.
- G2: test_generation runs only on the normal completion pipeline; recent missions were
  budget-exhausted (curated close-out excludes test_generation by design). A full-budget
  mission has not yet proven test-case generation.
- G3: test-case cards show no provenance; data chain exists
  (testCase.workflowId → workflow.sessionId → session.missionId).
- G4: featureGap heuristic can misclassify ContactVault as CRM (missing_feature findings
  with text evidence). NOT modified (protected). RUN B uses the known email-validation
  defect on :9906; "not discovered within authorized execution" is an honest outcome,
  distinct from system failure.
- G5: 3,378 legacy orphan evidence rows (sessionId null, 2026-08-17→08-30, old schema).
  Reported separately; not deleted.

## Controlled targets (existing benchmark infra, service qase-benchmark-apps)

- :9901 CRM (clean) — allowlisted VALID_PUBLIC_TARGET
- :9906 ContactVault-buggy — known email-validation defect
- :9907 ContactVault-fixed — clean variant

## Deliverables

1. **D1.2 live full-budget run** — mission with maxTurns 40 (within default 500, cap 500,
   via governor, no artificial completion, no direct test-gen API calls) against :9901.
   Verify: workflow exists with real captured steps; workflow.sessionId = mission session;
   test_generation ran on the normal pipeline; generated test case references the workflow;
   steps correspond to observed behavior; survives reload + service restart.
2. **D1.3 generated-test replay** — replay the generated test case via existing replay
   infrastructure. Verify real execution, truthful provider, steps against the target,
   assertions evaluated, persisted result, visible in API/UI history, no fake PASS.
   If an architectural limitation blocks safe replay: STOP and report it exactly.
3. **D1.4 evidence linkage** — every newly created evidence row for the golden mission has
   sessionId + missionId + iterationId; mission + session evidence endpoints return the
   expected records; zero new orphans. Legacy orphans reported separately.
4. **D1.5 finding quality, two runs** — RUN A clean target (:9907 or :9901 clean path):
   no invented findings; honest "no finding discovered" reporting where true. RUN B
   (:9906): known defect; if discovered: correct session/mission, meaningful evidence,
   truthful severity, reproducibility, execution provenance. If NOT discovered within the
   authorized budget: report honestly; distinguish from system failure. No C3 changes.
5. **D1.6 truthful failure** — controlled mid-execution failure (target passes pre-flight
   then fails during execution; e.g. benchmark app stopped after mission start, or a valid
   host serving a route that errors). Verify mission ≠ success, session ≠ false-success,
   failureReason present, no fabricated finding/test/evidence. targetGuard pre-flight
   tests remain.
6. **D1.7 refresh/reopen** — re-fetch mission, session, findings, evidence, workflow,
   test case, replay; all linked. Running-mission refresh creates no duplicate
   mission/session (409 on second start already proven; re-verified in suite).
7. **D1.8 service restart persistence** — procmgr restart of the QASE service
   (service-bg-service-3962), wait for /api/health 200, then re-fetch all seven artifact
   types; IDs and relationships intact. NO destructive container restart.
8. **D1.9 test-case provenance UI** — cards show concise Source line (Mission/Session/
   Workflow short IDs) where available, clickable where the existing hash router supports
   it (#/runs/:id, #/tests). No page redesign.
9. **D1.10 suite** — tests-real/d1-golden-e2e.test.js, 15 named cases D1.1–D1.15.
   LIVE E2E cases (real LLM/browser) explicitly labeled; API/contract cases separated.

## Suite case map

- D1.1 operator access: viewer 403 / operator+master allowed (LIVE, API)
- D1.2 real mission execution (LIVE E2E — full-budget golden mission)
- D1.3 evidence linkage (LIVE E2E)
- D1.4 finding quality two-run rules (LIVE E2E)
- D1.5 workflow creation (LIVE E2E)
- D1.6 test generation (LIVE E2E)
- D1.7 generated test replay (LIVE E2E)
- D1.8 truthful success (LIVE E2E)
- D1.9 truthful failure (LIVE E2E — controlled mid-execution failure)
- D1.10 refresh/reopen linkage (LIVE E2E)
- D1.11 service restart persistence (LIVE E2E — procmgr restart from the suite)
- D1.12 no orphan evidence (LIVE E2E)
- D1.13 no fabricated finding on clean run (LIVE E2E)
- D1.14 no duplicate mission on refresh (LIVE E2E)
- D1.15 test-case provenance UI (static asset grep + optional browser check)

## Regression battery

ui-access, security, b1-security-negative, b1-integration-auth, api-contract,
c2-autonomy-contract, c3-finding-quality, truthfulness/redteam-truth,
execution-provenance, mission-governor, browserstack-trust (no live creds),
phase16/17/18 relevant, e2e-ui journey, existing c4 suites. Every failure classified:
D1 regression / pre-existing / env precondition / flaky.

## Security rules

No tokens, LLM keys, BrowserStack creds, access codes, or session secrets in test
output, logs, or committed files. No auth weakening. No URL/query auth bypasses.
targetGuard untouched.

## Acceptance

D1 COMPLETE only with live evidence for every criterion in the approved list
(§COMPLETION CRITERIA of the D1 instruction). No commit/push until explicit
instruction.
