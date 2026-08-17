# Phase 17 — UX Intelligence & Application Quality Validation (spec)

Parent phase doc: `docs/PHASE_17_CURRENT_STATE.md` (inventory of what exists). This spec defines ONLY Phase 17 scope. Phase 0/16 contracts frozen.

## Goal
Produce structured APPLICATION QUALITY INTELLIGENCE beyond functional correctness: UX dimensions, workflow friction, navigation/form/error/feedback quality, accessibility baseline, responsive validation, validated feature gaps, evidence-backed recommendations, quality report — all evidence-backed, uncertainty-preserving, with human-review escape hatch for subjective judgments.

## Invariants (violations = phase failure)
1. An LLM opinion alone is NEVER a verified UX issue. Every VERIFIED issue must link >=2 evidence refs (or 1 strong: screenshot) from deterministic observation.
2. UX issues are stored SEPARATELY from bug findings (ux_issues not in findings store). Functional defects found by the sweep route into the normal findings path only via existing `report_finding` semantics — the sweep never mutates findings.json directly except… NO: the sweep does not write findings at all; UX issues live in ux-assessments store.
3. Uncertainty preserved: UNVERIFIED/UNKNOWN/OBSERVATION states must survive to API + report + UI.
4. Drytis v1 contract unchanged; all new routes additive behind requireIntegrationAuth + ownership.
5. Async post-processing only — mission critical path (agent run) unchanged; sweep runs setImmediate after Phase 16 enrichment trigger, bounded by its own timeout.
6. No new dependency additions without need; Playwright already present.
7. Redaction: all ux payload strings pass through redactString before store/serve.

## New modules (server/)
- `uxSweep.js` — headless multi-viewport deterministic sweep. Launch browser (reuse replay launch pattern), visit key pages (from appModel.observed.pages + workflow steps), at desktop/tablet/mobile. Collect per-page observations: DOM inventory (headings, forms, links, buttons, images), a11y checks (missing labels, button names, heading order, alt text, lang, title, tabindex>0, contrast pair counts where computable), responsive checks (horizontal overflow, clipped/touch-target, viewport meta, content > viewport), console errors, interaction feedback probes (submit empty form → validation feedback present? error text captured), navigation checks (404 links from same-page anchors, dead ends = pages with no outbound links). Bounded: N pages (default 12) × 3 viewports, hard timeout per page 10s, total sweep timeout 120s (config QASE_UX_SWEEP_TIMEOUT_MS). Never throws to caller.
- `uxChecks.js` — pure check catalog: check definitions with id, dimension, evaluate(pageData) → {status: PASS|ISSUE|UNVERIFIED, severity, evidence, detail}. Deterministic only.
- `uxModel.js` — dimensions (10): NAVIGATION, CLARITY, CONSISTENCY, FEEDBACK, ERROR_HANDLING, FORM_USABILITY, INFORMATION_HIERARCHY, ACCESSIBILITY, RESPONSIVENESS, USER_FLOW_FRICTION. Scoring: each check ISSUE with severity contributes deterministic deduction; score = 100 − Σ weighted deductions (cap floor 0); confidence from evidence coverage (checks PASS/ISSUE vs UNVERIFIED) and exploration depth. Issue records: {id, kind: FUNCTIONAL_DEFECT|UX_ISSUE|ACCESSIBILITY_ISSUE|FEATURE_GAP|OBSERVATION|RECOMMENDATION, dimension, title, severity, confidence, evidence[], workflow, viewport, expected, actual, impact, reviewState}.
- `uxFriction.js` — friction analysis from capturedSteps + workflowIntelligence outcomes: step counts vs template expectations, repeated same-field entry, failed→retry loops, missing confirmation (destructive action without dialog), dead ends. Friction point records {workflow, step, type, severity, confidence, evidence(step refs)}.
- `featureGapValidation.js` — gates gap assertions: (a) expectation provenance (explicit source required for CONFIRMED); (b) exploration sufficiency (coverage: pages visited, workflows tested vs expected, explorationConfidence >= threshold); (c) observation attempts (feature searched in inventory + workflow steps + DOM). Classification: IMPLEMENTED / PARTIALLY_IMPLEMENTED / NOT_FOUND / BLOCKED / UNVERIFIED (never CONFIRMED_MISSING without explicit expectation + sufficient exploration).
- `recommendationEngine.js` — deterministic: from ux issues + friction + validated gaps. Item {id, issue_ref, impact, recommendation, priority (P0-P3 formula: severity weight × workflow criticality × user impact × confidence, documented), confidence, evidence[]}. No code generation.
- `qualityAssessment.js` — dimensions: FUNCTIONAL (from calculateMissionQuality score), UX (weighted ux dimensions), ACCESSIBILITY (a11y checks), FEATURE_COMPLETENESS (validated gap classification), NAVIGATION (nav checks + friction), ERROR_HANDLING, WORKFLOW_RELIABILITY (workflowEngine outcomes). Each {score, confidence, evidenceCoverage}. Overall = weighted mean (weights documented), confidence = mean×evidenceCoverage. Stored `.qase/ux-assessments.json` keyed missionId+iteration.
- `uxAssessment.js` — store module (atomic write pattern) + orchestration `runUxAssessment(session, mission)` wiring sweep→checks→friction→gapValidation→recommendations→quality→persist + evidence nodes + SSE + metrics.

## API (additive, behind requireIntegrationAuth)
- GET `/api/v1/missions/:id/quality` → quality dimensions + overall.
- GET `/api/v1/missions/:id/ux` → ux assessment (dimensions, issues, friction).
- GET `/api/v1/missions/:id/feature-gaps` → validated feature gaps.
- GET `/api/v1/missions/:id/recommendations` → recommendations.
- PATCH `/api/v1/missions/:id/ux/issues/:issueId/review` → reviewState AUTO_VERIFIED|REVIEW_REQUIRED|REJECTED (+reason, by).
- Dashboard: GET `/api/missions/:id/ux-quality` (same payload, session-auth) — if mission routes pattern requires; reuse v1 handler with mission param.

## Report
`buildMissionReportMarkdown` gains sections (after quality header): APPLICATION QUALITY (overall + dimensions + confidence + evidence coverage), then grouped CRITICAL/HIGH/MEDIUM/LOW ux issues, FEATURE GAPS (validated), UX RECOMMENDATIONS, UNVERIFIED AREAS (list of UNVERIFIED checks + untested workflows). Labels distinguish VERIFIED ISSUE / OBSERVATION / UNVERIFIED / FEATURE GAP / RECOMMENDATION.

## UI
Mission detail (public/app.js): APPLICATION QUALITY panel — overall score, dimension bars with confidence + evidence coverage, drill-down per dimension → issues with evidence links (existing modal patterns), review buttons (Approve/Reject) for REVIEW_REQUIRED issues. Reuse existing CSS classes; no framework.

## Review states
AUTO_VERIFIED (deterministic evidence sufficient), REVIEW_REQUIRED (subjective judgment or ambiguous evidence — set when confidence < 0.6 OR dimension is CLARITY/CONSISTENCY-type judgment), REJECTED (human). Never auto-reject.

## Benchmark
`.drytis/benchmarks/ux-ground-truth.md` — per benchmark app (5 Phase-16 apps + as feasible): expected UX issues (id, app, dimension, description), expected feature gaps, expected functional issues, expected workflows. Runner: `scripts/ux-benchmark.mjs` — boots servers (reuse bench-servers.sh), runs missions limited? NO — runs the sweep+assessment directly against each app URL (deterministic, no LLM), compares to ground truth: UX precision/recall, feature-gap precision/recall, FP rate, evidence completeness. Output `.drytis/benchmarks/ux-benchmark-results.json` + md.

## Tests
Unit (new tests/phase17-*.test.js):
- uxChecks catalog: PASS/ISSUE/UNVERIFIED per check type; insufficient page data → UNVERIFIED not ISSUE.
- uxModel scoring: deductions, floor, confidence from coverage; issue kinds separation.
- friction: repeated entry, missing confirmation, dead end, excessive steps.
- featureGapValidation: explicit vs heuristic provenance; insufficient exploration → UNVERIFIED; IMPLEMENTED/PARTIAL/NOT_FOUND/BLOCKED.
- recommendation priority formula monotonicity (higher severity→P higher, etc.); recommendation references issue evidence.
- quality aggregation: dimension weights, evidenceCoverage effect, no-evidence → confidence low + UNVERIFIED presentation.
- review states transitions.
- redaction of ux payloads.
Integration (phase17-api.test.js, live server):
- assessment creation + persistence; evidence association; feature-gap generation; recommendation generation; quality report; auth (401/403); review PATCH; ux payload redaction; backward-compat (existing endpoints unchanged).
E2E (phase17-e2e.test.js — 10 spec cases): exploration works; ux observation generated; evidence attached; functional defect separate; feature gap from explicit requirement; unverified not marked missing; mobile viewport validation; a11y issue representation; recommendation references issue; quality report confidence/evidence.

## Performance gates
Sweep bounded (12 pages × 3 viewports × 10s page timeout, 120s wall). Runs async post-finalize; mission critical path untouched. Measure: baseline vs phase17 mission duration on benchmark apps; sweep+assessment latency; report generation overhead before/after.

## Security gates
All ux strings redacted on write AND read; no credential echo; sweep uses target URL only; review PATCH requires ownership; no new env secrets.

## Acceptance criteria (29)
- [ ] Phase 16 tests remain green (full suite before/after, baseline recorded)
- [ ] Drytis v1 contract unchanged (phase5-api.test.js green)
- [ ] UX assessment exists (sweep produces structured observations)
- [ ] UX assessment evidence-backed (every VERIFIED issue ≥ evidence refs; evidence nodes created)
- [ ] UX issues separated from functional defects (separate store; kinds distinct)
- [ ] Feature gaps require explicit expectations (heuristic source → UNVERIFIED max)
- [ ] Unverified behavior not presented as fact (API/report/UI all mark it)
- [ ] Workflow friction measured (friction records with evidence)
- [ ] Navigation quality evaluated (checks exist + dimension scored)
- [ ] Form usability evaluated (labels/required/types/messages checks)
- [ ] Error experience evaluated (error classification incl. TECHNICAL_ERROR_EXPOSURE, UNHELPFUL_ERROR, MISSING_RECOVERY, DATA_LOSS_RISK, GOOD_ERROR_HANDLING)
- [ ] Feedback states evaluated (loading/success/failure probes)
- [ ] Accessibility baseline exists (≥8 checks, PASS/ISSUE/UNVERIFIED per check, no WCAG claim)
- [ ] Responsive/mobile evaluated at ≥3 viewports with dims recorded
- [ ] Recommendations reference actual evidence (issue_ref → evidence[])
- [ ] Quality dimensions expose confidence + evidence coverage
- [ ] Quality report distinguishes verified/unverified
- [ ] Benchmark exists (ux-ground-truth.md + runner)
- [ ] UX precision measured
- [ ] Feature-gap precision measured
- [ ] FP rate measured
- [ ] Evidence completeness measured
- [ ] No security regression (redaction tests + authz tests green)
- [ ] No authorization regression (401/403 tests)
- [ ] No sensitive-data leakage (redaction on all payload paths)
- [ ] No meaningful critical-path performance regression (async only; measured)
- [ ] Review states implemented (AUTO_VERIFIED/REVIEW_REQUIRED/REJECTED)
- [ ] UI panel exists with drill-down
- [ ] Docs: UX_INTELLIGENCE_MODEL.md, FEATURE_GAP_MODEL.md, QUALITY_ASSESSMENT_MODEL.md, PHASE_17_REPORT.md

## Stop rule
After Phase 17 report: STOP. No Phase 18, no security intelligence, no compliance, no autonomous fixing, no CI/CD gates.
