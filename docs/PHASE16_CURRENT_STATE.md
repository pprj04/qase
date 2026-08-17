# PHASE16_CURRENT_STATE.md — Bug Intelligence 2.0 Starting Point

**Date:** 2026-08-15
**Purpose:** Document the existing finding/bug intelligence implementation before Phase 16 (Bug Intelligence 2.0) modifies it. Produced by direct codebase inspection.

---

## 1. Existing finding pipeline (data flow)

```
Execution            Agent `report_finding` tool (server/qaTools.js)
                       │ (also: workflow pipeline findings via server/workflowEngine.js:805,
                       │        and manual UI/API POST /api/findings)
                       ▼
Observation          session.findings[] (server/store.js) + SSE 'finding' event
                       ▼
Evidence             evidenceGraph.collectSessionEvidence (server/evidenceGraph.js:1004)
                     — only step_outcome + finding_detail evidence types in practice;
                     — binary artifacts (screenshots/traces) live in .qase/artifacts/<runId>/
                       (NOT linked from findings; only from replay runs)
                       ▼
Finding              syncSessionFinding → global store (server/findings.js) → .qase/findings.json
                       ▼
Mission finalize     finalizeMissionFromSession (server/index.js ~2860):
                       duplicateSuppression.correlateFindings (session copies only),
                       scoreFindingQuality (devIntelligence.js:214) — confidence backfill,
                       devIntelligence analysis, workflow findings merge,
                       writeKnowledge (≥ medium severity only), validationLoop decision
                       ▼
Review               Bugs Hub UI (public/bugs.js) — status/assignee/comments; NO false-positive
                     or duplicate review semantics
                       ▼
Report               server/report.js buildReportMarkdown + buildMissionReportMarkdown
                     (index.js:3458) + exporters (GitHub/Jira/Linear/MD)
```

Revalidation: `POST /api/v1/missions/:id/revalidate` creates a NEW session+iteration;
`compareIterations` (devIntelligence.js:406) computes fixed/remaining/regressions at mission
level; `classifyRevalidation` (workflowEngine.js:869) → CONFIRMED/INTERMITTENT/NOT_REPRODUCED/BLOCKED
per workflow. **Global-store findings are never updated by revalidation** — no per-finding
reproduction attempt tracking exists.

## 2. Existing data models (exact shapes)

### Finding (server/findings.js addFinding:149) — `.qase/findings.json`
```
id, ts, sessionId, projectId, title, severity('critical'|'high'|'medium'|'low'|'info'),
category (free text), url, status('open'|'in_testing'|'resolved'|'closed'), steps[],
expected, actual, evidence (single free-text string — NOT typed refs), testCaseIds[],
assignee, comments[{id,ts,author,text}], history[{ts,from,to,by,detail}], tags[],
```
Evidence-Engine additive fields (undefined-when-absent): `observed, impact, recommendation,
fixPrompt, confidence (0–1), isDuplicate, duplicateOf, reproducibility('confirmed'|
'unconfirmed'|'intermittent')`, plus `devIntelligence{rootCause,fixApproach,affectedArea,
estimatedComplexity,confidence,analyzedAt}` and `createdBy('agent'|'user')`.

### No separate bug model — "bug" is a UI alias for finding (Bugs Hub = Phase 11).
### Evidence (server/evidenceGraph.js) — `.qase/evidence-graph.json`
Evidence: `{id:'ev_*', missionId, iterationId, sessionId, type(11 types), source, timestamp,
target, action, observation, payload, confidence, integrity, metadata}`; observations link
`evidenceIds[]`+`findingIds[]`. `GET /api/findings/:id/evidence` maps graph items per finding.
### Mission/session — `server/missions.js` / `server/store.js`; findings linked to missions only
via embedded copies in `mission.iterations[].findings` + `sessionId` on global findings.
### Workflow models — saved workflows (`server/workflows.js`: steps with outcomes) vs expected-
workflow pipeline (`server/workflowEngine.js`: templates, priorities, outcomes, revalidation
classification). **No workflowId/featureId on global findings.**
### Feature model — `server/intentModel.js deriveExpectedFeatures` + `server/expectedVsObserved.js`
(STATUS: implemented|implemented_but_broken|partially_implemented|missing|not_tested|…).

## 3. Existing APIs (findings/bugs/evidence/reports)

Internal (`/api/*`, mutating routes behind `requireApiToken`):
- `GET /api/findings` (filters: projectId, severity, status, category, assignee, sessionId, q)
- `GET /api/findings/stats`, `GET /api/findings/export`, `POST /api/findings`
- `GET|PUT|DELETE /api/findings/:id` (detail enriched with linkedTests)
- `PATCH /api/findings/:id/status`, `POST /api/findings/:id/comments`
- `POST|DELETE /api/findings/:id/link/:testCaseId`
- `GET /api/findings/:id/evidence` — typed evidence chips
- `GET /api/findings/:id/dev-analysis`, `GET /api/findings/:id/fix-prompt`
- `GET /api/sessions/:id/export/findings`, `/report.md`, `/dev-report`, …
- `GET /api/artifacts/:runId/:filename`

External (`/api/v1/*`, Bearer/JWT): missions CRUD/start/iterate/revalidate/loop-status/
comparison/report, evidence endpoints, evidence-chain per mission finding, sessions
observations/evidence, workflows, workflow-failures, intent, webhooks.
**No `/api/v1/findings` exists** — findings reach v1 consumers only embedded in mission payloads.

## 4. Existing UI for findings/bugs

- `public/bugs.js` (Bugs Hub): board/list, filters (severity/status/category/search), stats,
  detail modal (badges, steps, expected/actual, evidence text, linked tests, comments, Dev
  Intelligence, history, status/assignee/delete), new-finding editor, exports.
- `public/app.js` (~900–1050): session findings — confidence/reproducibility badges, evidence
  text + "View Evidence" typed chips, Revalidate button, "Copy as ticket".

## 5. Existing classification / severity / confidence

- Severity: LLM-assigned via tool schema (qaTools.js:28), default medium; workflow findings
  derive from step criticality (workflowEngine.js:801). No heuristic override.
- Category: free text from LLM; no enum; UI builds the dropdown from data (bugs.js:40).
- Confidence: 4 separate systems — (a) agent-set finding.confidence with heuristic backfill
  (scoreFindingQuality: expected+actual +0.3, steps≥2 +0.25, evidence +0.25, observed +0.1,
  recommendation +0.1), (b) evidence-graph confidence (weighted source-reliability model,
  evidenceGraph.js:723), (c) knowledge confidence (knowledgeModel.js), (d) LLM devIntelligence
  confidence. None are reconciled into one explainable score.

## 6. Existing verification / duplicate handling

- Verification: none per-finding. Evidence sufficiency exists only at mission level
  (determineEvidenceStatus: verified = 2+ items from 2+ unique sources).
- Duplicates: `duplicateSuppression.correlateFindings` — Jaccard similarity on title/description
  + bonuses (same workflow +0.20, url +0.15, severity +0.1, category +0.12, root cause +0.15,
  temporal +0.08; thresholds 0.38/0.50); mutates session copies at mission finalize;
  **isDuplicate/duplicateOf not synced back to the global store** (findings.js sync whitelist).
  scoreFindingQuality has a separate exact-title+URL duplicate check.

## 7. Existing limitations (what Phase 16 must address)

1. Findings lack `missionId`, `workflowId`, `featureId`, typed evidence refs.
2. `evidence` is one free-text string; no evidence sufficiency gate for VERIFIED.
3. Category uncontrolled free text — no taxonomy, no secondary categories, no confidence.
4. No per-finding revalidation outcome / reproduction attempt tracking.
5. No review semantics (false positive / duplicate / uncertain outcomes).
6. Lifecycle is open→in_testing→resolved→closed only; uncertainty states don't exist.
7. Dedup results never reach the global store; no POSSIBLE_DUPLICATE tier.
8. No priority separate from severity; no structured risk.
9. Reports group by nothing — severity sort only.
10. Benchmark precision/recall is manual (no automated ground-truth matcher).
11. `sessions.json` is 114MB and findings sync embeds copies — enrichment must be async to
    avoid slowing the execution engine (performance requirement).
12. No redaction layer for secrets in evidence/reports.

## 8. Files/modules that WILL be changed (planned)

| File | Change |
|---|---|
| `server/findings.js` | Lifecycle + review status enums, new optional fields, filters, grouped report data |
| `server/index.js` | New endpoints (classification/severity/priority/review/duplicates/related/evidence), async enrichment hook, metrics |
| `server/devIntelligence.js` | Integrate deterministic intelligence engine into finalize (async post-processing) |
| `server/duplicateSuppression.js` | Reuse as duplicate candidate generator; keep thresholds; add global-store sync + POSSIBLE tier |
| `server/workflowEngine.js` | Map workflow findings → global store linkage (workflowId/featureId) — additive |
| `public/bugs.js` | Card fields + new filters + review actions |
| `public/app.js` | Session finding cards show enriched fields |
| `server/report.js` + mission report builder | Grouped report generation (category/severity/priority/workflow/risk), dedup-aware counts |
| `tests/*` | New phase16 tests; no changes to existing expectations |

## 9. Files/modules that must NOT be changed

- `server/qaTools.js` tool schema (agent contract frozen) — **read-only reuse**
- `server/store.js` session model & SSE bus
- `server/missions.js` mission model, idempotency, lifecycle, iterations
- `server/evidenceGraph.js` (evidence/observation/edge model — read-only reuse)
- `server/validationLoop.js` decision engine (reuse `resolveAction`)
- `server/knowledge*.js` (read-only reuse of writeKnowledge)
- `server/replay.js`, `server/baselines.js`, regression/suites stores
- `.drytis/benchmarks/*` ground truth (frozen Phase 0 assets)
- Auth: `requireApiToken` / `requireIntegrationAuth` architecture (only additive routes)
- Playwright/agent runtime, browser tooling, `public/router.js` routing model

## 10. Existing tests & benchmark

- Tests: `tests/` (35 files, node:test against live server at :5173 with QASE_API_TOKEN).
  Known infra flakiness: full-suite parallel runs may hit ECONNREFUSED (BASELINE.md:804).
  Baseline re-run recorded before implementation (see PHASE_16_REPORT.md).
- Benchmark: 11 HTML apps (ports 9901–9911) + `ground-truth.md` (43 planted issues).
  Runners: `.drytis/benchmark-runner.js` (resumable, ~6 min/app) and `.drytis/run-benchmark.js`.
  Latest recorded metrics (phase-7-benchmark-results.md): 103 findings — 64% unique TP,
  23% duplicates, 13% FP; recall 51% (bug recall 69%, missing-feature 43%).
