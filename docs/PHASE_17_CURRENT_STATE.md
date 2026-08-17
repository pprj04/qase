# Phase 17 — UX Intelligence & Application Quality Validation: Current State

Survey date: after Phase 16 freeze. All file references verified against the working tree.

## 1. What already exists (functional)

### Application understanding — EXISTS
- `server/appModel.js` — AppModel factory: intent (buildPrompt, requirements, derivedExpectations), observed (pages, formFields, authState, verifiedFeatures, brokenFeatures, explorationDepth, explorationConfidence), understanding (purpose, domain, features{expected,observed,verified,broken,unverified}, workflows, authenticationModel), unknowns, conflicts, per-area confidence `{value, basis[]}`, evidence refs. `summarizeAppModel` for pipeline summary.
- `server/appUnderstanding.js` — `buildAppUnderstanding(session, missionContext, opts)` fills the model; LLM optional (purpose derivation), sanitized.
- `server/intentModel.js` — `createMissionIntent`: expectedFeatures with provenance (rawExpected 1.0 → requirements 0.95 → buildPrompt keywords 0.9 → objectives 0.75), expectedWorkflows, DOMAIN_CATALOG.
- `server/domainUnderstanding.js`, `server/preUnderstanding.js` — domain classification + pre-exploration prompt context.
- Stored on `session.appModel`; exposed via `/api/sessions/:id/app-understanding*` and `/api/v1/missions/:id/understanding` (reads `mission.context.phase8`).

### Mission context — EXISTS
- `server/missions.js` — mission record with free-form `context` (buildPrompt, requirements, testCredentials, expectedFeatures, expectedWorkflows, phase8, coverage). `qualityScore` stored, not computed here.
- `MISSION_TYPES` already includes `'ux'` and `'accessibility'` — **prompt text only** (index.js:3083, validationLoop.js:476); no specialized behavior.

### Workflows — EXISTS (two layers)
- `server/workflows.js` — `captureStep`/`finalizeStepOutcome`: the only per-step persisted observation data (`{status, urlAfter, titleAfter, error, elementsFound, consoleErrors, networkErrors, dialogAppeared}`). Saved workflows drop outcomes.
- `server/workflowEngine.js` — 13 canonical workflow templates with per-step expectedResult/validationMethod; outcomes pass/failed/partially_completed/blocked/not_tested; coverage computation. Results at `mission.context.phase8.workflowIntelligence`.

### Feature extraction & gaps — EXISTS (binary)
- `server/featureGap.js` — inventory extraction, expected-feature sourcing (context keywords conf 1.0 → purpose heuristics → domain catalog → optional LLM), `detectFeatureGaps` (binary gaps + `isExistingButBroken`), `gapsToFindings`.
- `server/expectedVsObserved.js` — **`FEATURE_STATUS` enum: implemented, implemented_but_broken, partially_implemented, missing, not_tested, not_applicable, unknown**; gap report with provenance. Runs at mission finalize; stored `mission.context.phase8.expectedVsObserved/.gapReport`.
- Limitation: no exploration-sufficiency gate — "missing" is asserted from single-mission observation without checking whether exploration was deep enough. No UNVERIFIED discipline for heuristic-sourced expectations.

### Findings & evidence — EXISTS
- `server/findings.js` — finding store (`.qase/findings.json`), Phase 16 intelligence fields, review status, filters, grouped counts.
- `server/findingIntelligence.js` — 20 categories (UX, ACCESSIBILITY, MOBILE already enum values — **nothing deterministic assigns them**), lifecycle, priority, risk, duplicate detection, `redactString` (reusable redaction), linkage derivation (workflow/feature/page/component/api, UNKNOWN-safe).
- `server/evidenceGraph.js` — 12 evidence types (screenshot, video, network, console, dom, api_response, log, trace, assertion, observation, step_outcome, finding_detail), integrity hashes, `collectSessionEvidence` auto-collector, coverage computation.
- `server/evidenceStore.js`/artifacts — screenshots persisted under `.qase/artifacts/<runId>/` (replay pattern, `saveScreenshot`).

### Quality scoring — EXISTS, single-dimension
- `server/devIntelligence.js` `calculateMissionQuality` — severity-weighted logarithmic deduction from 100; `breakdown` by severity only; verdict pass/pass_with_issues/fail. **No UX/accessibility/responsive dimensions, no per-dimension confidence.** Called at mission finalize (index.js:3321) and stored on mission.
- Per-dimension confidence exists only on AppModel and on findings (`computeQuality`), not at mission level.

### Recommendations — EXISTS (LLM opinion)
- `devIntelligence.buildAppImprovementReport` — LLM JSON with `ux[]`, `accessibility[]` arrays — **the only structured UX output today; derived purely from finding text by the LLM, no observation data, no evidence refs, no deterministic priority.**
- Phase 16 `dev_summary`/`recommendation` fields on findings.

### Reports — EXISTS
- `server/report.js` (session) and `index.js buildMissionReportMarkdown` (mission, index.js:3787) — header w/ quality score, findings by group (category/severity/priority/workflow/feature/risk), per-finding detail, recommendations. **No quality-dimension section, no UX section, no unverified-areas section.**

### Agent capabilities & exploration — EXISTS (partial)
- `server/agent.js` ALLOWED_TOOLS: browser_* incl. screenshot, snapshot, diagnostics, set_viewport; update_todo; report_finding; finish_qa_report.
- `server/prompt.js:78-81` already instructs responsive testing (desktop→tablet 768×1024→mobile 375×812) — **prompt-trust only; nothing enforces or measures it.**
- `server/qaTools.js` `set_viewport` records `session.viewportsExplored` — **recorded but never read by any analysis.**
- `server/capabilities.js` — CapabilityRegistry + Orchestrator (topo sort, timeout, retry). 10 capabilities registered; no UX capability.

### Browser observation — EXISTS (partial)
- `server/browserBridge.js` — live frame streaming (not persisted), selector back-fill, navigation settle, dead-browser recovery, credential substitution from vault.
- Per-step persisted data = step outcome only (url/title/error/counts). **No DOM snapshot, no screenshot, no viewport dimension, no console text persisted per step.**
- `server/replay.js` — headless Playwright launch (`launchBrowser`, BrowserStack or local chromium), artifacts saving — **reusable as the pattern for an independent headless sweep.**

### Security — EXISTS
- `server/secrets.js` — session vault, `{{PLACEHOLDER}}` substitution, deep `redact()`.
- `findingIntelligence.redactString` — pattern-based redaction (passwords/tokens/keys/cookies) applied on read paths and evidence payloads.
- v1 API behind `requireIntegrationAuth` (JWT), workspace/project/mission ownership checks.

### Observability — EXISTS
- `/api/metrics/dashboard` (getDashboardMetrics), `/api/bug-intelligence/metrics` (Phase 16 telemetry pattern: counters + rates).

## 2. What is partial

| Area | What works | What's missing |
|---|---|---|
| Multi-viewport | VIEWPORT_PRESETS (desktop/tablet/mobile/mobile_small), `set_viewport` tool, `viewportsExplored` recorded, test-case/replay plumbing (Phase 14) | No automated responsive checks, no viewport-specific issues/findings, viewportsExplored unused |
| Error experience | console/network error counts per step; diagnostics tool | No classification of error UX (understandable? recoverable? input preserved?), no text capture |
| Feedback | step outcome records URL/title change + dialogAppeared | No analysis of loading/success/failure feedback quality |
| Forms | appModel.observed.formFields (inventory) | No usability evaluation (labels, required marking, input types, validation messages) |
| UX categories in taxonomy | UX/ACCESSIBILITY/MOBILE enum values + keyword classifier | No measurement behind them — LLM/keyword-only |

## 3. What is mocked / placeholder
- Mission types `ux`/`accessibility` — prompt text only.
- `devIntelligence` appReport `ux[]`/`accessibility[]` — LLM-generated from finding text, no observation basis (by design LLM-opinion; Phase 17 must not treat it as verified).
- knowledge model 'accessibility_issue' keyword classifier.

## 4. What is missing (to build in Phase 17)
1. **UX observation collection** — deterministic headless sweep (multi-viewport DOM/a11y/responsive/console) producing structured raw observations. Reuses `replay.js` launch pattern; zero changes to agent runtime.
2. **UX check catalog** — per-check PASS/ISSUE/UNVERIFIED across navigation, clarity, consistency, feedback, error handling, form usability, hierarchy, accessibility, responsiveness.
3. **UX dimension model** — 10 dimensions, each score 0–100 + confidence + evidence + issues + recommendations; issue kinds FUNCTIONAL_DEFECT/UX_ISSUE/ACCESSIBILITY_ISSUE/FEATURE_GAP/OBSERVATION/RECOMMENDATION kept separate from bug findings.
4. **Workflow friction analysis** — from capturedSteps/workflow outcomes: step counts, repeated entry, missing confirmations, dead ends.
5. **Feature-gap validation** — exploration-sufficiency gates over expectedVsObserved; explicit-expectation-only confirmation; POTENTIAL vs CONFIRMED discipline; IMPLEMENTED/PARTIALLY_IMPLEMENTED/NOT_FOUND/BLOCKED/UNVERIFIED classification.
6. **Recommendation engine** — deterministic, evidence-referencing, documented P0–P3 priority formula (no LLM priority).
7. **Application quality assessment** — extends (not replaces) calculateMissionQuality: FUNCTIONAL, UX, ACCESSIBILITY, FEATURE_COMPLETENESS, NAVIGATION, ERROR_HANDLING, WORKFLOW_RELIABILITY dimensions with score+confidence+evidence coverage.
8. **Human review states** — AUTO_VERIFIED/REVIEW_REQUIRED/REJECTED for subjective UX findings.
9. **APIs** — additive v1 routes (quality/ux/feature-gaps/recommendations) behind existing auth; review route.
10. **UI** — Application Quality panel (overall + dimensions + confidence + evidence coverage + drill-down) using existing dashboard patterns.
11. **Report extension** — executive quality summary, issue severity groups, feature gaps, UX recommendations, unverified areas; VERIFIED/OBSERVATION/UNVERIFIED/FEATURE GAP/RECOMMENDATION distinction.
12. **UX benchmark** — ground truth + deterministic benchmark runner + precision/recall/FP/evidence-completeness measurement.
13. **Observability** — ux metrics counters in the existing metrics pattern.

## 5. What can be reused as-is (no modification)
- `server/findingIntelligence.js` (enrichment, redactString, grouping) — Phase 16 frozen.
- `server/evidenceGraph.js` — create evidence nodes of existing types; no enum change needed (`dom`, `screenshot`, `observation`, `console`, `network` cover the sweep).
- `server/expectedVsObserved.js` FEATURE_STATUS enum — the Phase 17 completeness vocabulary maps onto it.
- `server/workflowEngine.js` results — workflow reliability input.
- `server/replay.js` `launchBrowser` pattern + `VIEWPORT_PRESETS`/`resolveViewport` from config.
- `calculateMissionQuality` — functional dimension input, unchanged.
- v1 auth middleware (`requireIntegrationAuth`, workspace/project/mission ownership).
- Dashboard SSE plumbing (`emit`), mission summary bar pattern, artifacts dir pattern.
- `phase14` coverage report (`buildCoverageReport` at mission.context.coverage) — exploration-sufficiency input.

## 6. Files that must change
- `server/index.js` — finalize async hook (parallel to Phase 16 enrichment), 4 additive v1 routes + dashboard routes, mission report markdown extension, metrics registration, SSE event.
- `public/app.js` (+ small `index.html`/`styles.css` additions) — Application Quality panel + drill-down.
- `server/store.js` — none expected (assessment stored via new store module).
- `docs/` + `README.md` — new model docs, report, API addendum.
- `.drytis/specs/phase17-ux-quality.md` (new; note: phase17a/b spec names already taken by self-heal — Phase 17 UX uses `phase17-ux-quality`).

## 7. Files that must remain untouched
- `server/agent.js`, `server/browserBridge.js`, `server/qaTools.js`, `server/prompt.js` — Phase 0 runtime frozen.
- `server/findingIntelligence.js`, `server/findings.js`, `server/findingEnrichment.js` — Phase 16 contract frozen (read-only reuse).
- `server/missions.js` record shape — context is free-form; additive keys only (`context.phase17`), no migration.
- Phase 16 API routes and webhook contract — additive routes only.
- `.drytis/benchmarks/ground-truth.md` — frozen functional ground truth; UX ground truth goes in a new file.

## 8. Storage plan
- New JSON store `.qase/ux-assessments.json` (same atomic-write pattern as findings.json) keyed by assessment id, indexed by missionId/iterationId. **No findings-store schema change; no migration; old data unaffected.** Evidence nodes are additive rows in the existing evidence graph.
