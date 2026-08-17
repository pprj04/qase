# PHASE 9.1 — BASELINE AUDIT
## Pre-Implementation Record

### Test Suite Baseline (pre-Phase 9.1)
- **Total tests:** 538
- **Passed:** 529
- **Failed:** 9
- **Skipped:** 0
- **Pre-existing failures:** 9 (all in tests/phase11a-findings-store.test.js)
  - Migration: "should have migrated findings from sessions"
  - Filtering: severity filter, search query, projectId filter, stats
  - Export: markdown, GitHub, JIRA, Linear formats
- **Corrupted test file:** tests/phase1-pipeline-reliability.test.js (ext4 -117 corruption, excluded)

### Phase 9 Benchmark Baseline (from phase-9-report.md)
| Metric | Phase 9 Value | Target |
|--------|---------------|--------|
| Mission completion | 5/5 | 5/5 |
| Domain accuracy | 5/5 (100%) | ≥70% |
| Domain confidence (avg) | 0.59 | ≥0.70 |
| Duplicate rate | 45% | <23% |
| EVO result count | 0 | >0 |
| Gap report (missing/broken) | 0/0 | >0/>0 |
| Workflow count | 24 | >0 |
| Workflow step count | 100 | >0 |
| Workflow coverage | 100% | >0 |
| Workflow pass rate | 0% | — |
| Workflow failure findings | 8 | >0 |
| Quality score range | 9-15 | No 0s |
| Hallucinations | 0 | 0 |
| Revalidation iterations | 0 (not demonstrated) | >0 |
| Domain mismatch | SaaSLaunch → CRM workflows | None |

### Root Cause Analysis (from code reading)

**1. EVO returns 0 results:**
- buildObservedFeatures depends on session.appInventory being populated
- If appInventory is empty (common when agent doesn't produce structured inventory), observedFeatures is empty
- All expected features become NOT_TESTED or MISSING
- EVO technically "works" but produces no meaningful results because observed is empty
- The stored EVO summary shows counts but the phase9-report showed "EVO results: 0" because the field is named differently

**2. Gap report empty:**
- Gap report is derived from EVO comparison results
- If EVO features are all NOT_TESTED (because observed is empty), no gaps are classified as missing/broken
- Workflow gaps use old keyword-based step outcome which mostly returns 'unknown' not 'issue_found'
- generateGapReport checks workflow steps for outcome='issue_found' but old EVO buildWorkflowModel uses resolveStepOutcome which returns 'passed' or 'issue_found' only

**3. Duplicate rate 45%:**
- Workflow failure findings (category='workflow_failure') are generated for every failed step
- Multiple failed steps in same workflow produce similar findings
- These overlap with feature findings (e.g., "lead_to_deal: qualify_lead failed" vs "Pipeline is empty")
- Root cause correlation only matches on same feature + title Jaccard ≥0.25, but workflow findings have different title patterns
- WORKFLOW_MATCH_BONUS (0.20) is applied only when both findings have same workflowId, but feature findings don't carry workflowId

**4. Domain confidence 0.59:**
- classifyDomain confidence is sum of weighted evidence source scores
- When auth is broken, agent can't explore deeply → fewer capturedSteps → less static/structural/interactive evidence
- Intent evidence alone (weight 0.35) produces ~0.35 score
- With some static text evidence (~0.15) total reaches ~0.50-0.59
- Need: leverage more evidence signals — requirements text, expected features, build prompt directly

**5. Domain mismatch (SaaSLaunch gets CRM workflows):**
- deriveExpectedWorkflows scans buildPrompt for keywords via matchFeatureFromText
- SaaSLaunch buildPrompt: "A SaaS marketing landing page promoting a project management tool"
- "project management" keyword matches project_management domain
- "project" keyword also matches project_management
- This adds task_lifecycle and sprint_planning workflows
- DOMAIN_CATALOG.marketing.workflows = ['signup_flow', 'navigate_sections'] — correct
- But the buildPrompt mentions "project management tool" so PM workflows get inferred
- Fix: when domain is confirmed (marketing), filter workflows to domain-appropriate ones unless explicitly required

**6. Step validation keyword-based:**
- collectStepEvidenceEnhanced uses substring matching of step name words against session text
- validateWorkflowSteps marks PASSED when both isObserved AND isTested (both keyword-based)
- No DOM evidence, no action type correlation, no resulting-state verification
- Need: evidence-driven validation that requires actual browser action evidence

### Files to Modify (Phase 9.1)
1. `server/expectedVsObserved.js` — Fix buildObservedFeatures to use session data more effectively
2. `server/duplicateSuppression.js` — Intelligent root-cause correlation model
3. `server/workflowEngine.js` — Domain-aware workflow filtering, evidence-driven step validation
4. `server/domainUnderstanding.js` — Confidence improvement from more evidence sources
5. `server/intentModel.js` — Domain-specific workflow filtering
6. `server/index.js` — Pipeline wiring, auto-revalidation
7. `server/validationLoop.js` — Automatic revalidation on REVALIDATE decision
8. `public/pipeline.js` — UI updates
9. New: `tests/phase9.1-stabilization.test.js` — 40+ new tests
