# Phase 9 — Workflow Intelligence & Evidence-Driven Validation

## Current Architecture (Post-Phase 8)

### What Exists and Works
- **Workflow Model**: `buildWorkflowModel()` in `expectedVsObserved.js:385` produces workflow objects with steps, but uses naive keyword matching for step observation/testing. Post-hoc only.
- **Agent Browser Operations**: 23 tools including browser_open, browser_click, browser_type, browser_fill, browser_select_option, browser_press_key, browser_hover, browser_scroll, browser_screenshot, browser_snapshot, browser_diagnostics, browser_wait, browser_tabs. Full execution capability.
- **Evidence Graph**: `evidenceGraph.js` — 12 EVIDENCE_TYPES, 14 EDGE_TYPES, createEvidence, linkEvidenceToFinding, collectSessionEvidence, computeEvidenceCoverage. Fully functional.
- **Duplicate Suppression**: `duplicateSuppression.js` — Jaccard similarity (threshold 0.45) + feature bonus (0.25) + proximity bonus (0.15). 28% average dup rate.
- **Quality Scoring**: `calculateMissionQuality()` — linear deduction model (100 minus severity-weighted deductions). Collapses to 0 for many findings.
- **Validation Loop**: `validationLoop.js` — manual trigger via POST /revalidate, buildRevalidationPrompt includes previous findings but NOT workflow gaps.
- **Agent Prompt**: `buildMissionPrompt()` includes build prompt, requirements, business goals, expected features — but NO workflows, NO workflow steps, NO gap report.

### Gaps (Verified from Source Code)
1. **Workflows are NOT injected into the agent prompt** — `buildMissionPrompt()` at index.js:2369 has no workflow context. Agent explores without knowing what workflows to test.
2. **Workflow step observation is keyword matching** — `wasStepObserved()`/`wasStepTested()` in expectedVsObserved.js split on `_` and do substring matching against session text blob. Not real step validation.
3. **Revalidation prompt lacks gap report** — `buildRevalidationPrompt()` doesn't include broken/incomplete workflows from the gap report.
4. **No auto-chain in validation loop** — `resolveAction()` returns 'revalidate' but no caller auto-triggers the next iteration.
5. **No workflow evidence in evidence graph** — workflows aren't linked to evidence nodes.
6. **Quality scoring collapses to 0** — linear deduction over-penalizes apps with many findings.
7. **Duplicate rate 28%** — threshold 0.45 may be too high; root-cause grouping is shallow.

## Proposed Changes

### New Module: `server/workflowEngine.js`
- `hardenWorkflowModel(expectedWorkflows, domain, intent)` — enriches each workflow with canonical step structure (id, action, target, expectedResult, validationMethod, evidenceRequired)
- `prioritizeWorkflows(workflows, intent, domain, knowledge)` — deterministic scoring (explicit > auth-dependent > critical-path > domain-standard > knowledge)
- `planWorkflowExecution(workflows, session, credentials, previousEvidence)` — creates executable plans for high-priority workflows
- `classifyWorkflowOutcome(workflow, stepResults)` — PASS/FAILED/PARTIALLY_COMPLETED/BLOCKED/NOT_TESTED/NOT_APPLICABLE/UNKNOWN
- `buildWorkflowContextForPrompt(workflows, executionPlan)` — injects workflow guidance into agent prompt
- `connectWorkflowResultsToComparison(workflowResults, expectedVsObserved)` — maps workflow failures to feature status changes

### Modified: `server/index.js`
- `buildMissionPrompt()` — inject expected workflows + workflow steps
- `finalizeMissionFromSession()` — run workflow engine pipeline (harden → prioritize → classify outcomes → connect to EVO → evidence)
- `buildRevalidationPrompt()` — inject gap report with broken/incomplete workflows

### Modified: `server/expectedVsObserved.js`
- Replace keyword-based `wasStepObserved()`/`wasStepTested()`/`resolveStepOutcome()` with workflow execution result-driven versions
- Step status now comes from actual execution, not substring matching

### Modified: `server/duplicateSuppression.js`
- Lower similarity threshold from 0.45 to 0.38
- Add workflow context to correlation (same workflow → higher similarity)
- Add root-cause grouping (findings about same feature + same workflow → group)

### Modified: `server/devIntelligence.js`
- Replace linear deduction with capped/logarithmic model
- Factor in workflow success rate and feature coverage
- Score remains interpretable (0-100) but doesn't collapse to 0

### Modified: `server/validationLoop.js`
- Inject gap report into revalidation prompt
- Auto-chain: when iteration completes, check if action=revalidate and trigger next iteration

### Modified: `public/pipeline.js` + `public/index.html`
- Workflow Validation section showing coverage, per-workflow status, step-level pass/fail

### New: `tests/phase9-workflow-intelligence.test.js`
- Workflow hardening, prioritization, execution planning, outcome classification, EVO integration, evidence linking, revalidation

## Acceptance Criteria

- [ ] Workflow model has canonical structure (id, name, purpose, priority, provenance, preconditions, steps[], expectedOutcome, criticality)
- [ ] Each step has (id, action, target, expectedResult, validationMethod, evidenceRequired)
- [ ] Provenance distinguishes EXPLICIT/INFERRED/DOMAIN_STANDARD/UNKNOWN
- [ ] Workflows are prioritized deterministically (explicit > auth > critical-path > domain-standard > knowledge)
- [ ] Workflow context is injected into agent exploration prompt
- [ ] Workflow outcomes are classified (PASS/FAILED/PARTIAL/BLOCKED/NOT_TESTED/NA/UNKNOWN)
- [ ] Failed workflow steps produce findings connected to features
- [ ] Evidence graph contains workflow evidence
- [ ] Duplicate rate < 23% average
- [ ] Quality scoring doesn't collapse to 0 for many findings
- [ ] Revalidation prompt includes workflow gaps
- [ ] UI exposes workflow validation results
- [ ] 5/5 benchmark missions complete
- [ ] Bug recall does not regress from Phase 8's 100%
- [ ] Missing-feature recall does not regress from 70%
- [ ] All existing tests pass
- [ ] New Phase 9 tests pass

## Benchmark Strategy
Re-run the same 5 benchmark apps (CRM, TaskBoard, ShopHub, MetricsPro, SaaSLaunch) with full intent. Measure: workflow discovery, execution coverage, pass/fail accuracy, bug recall, missing-feature recall, false positives, duplicate rate, evidence coverage, mission completion, re-validation.
