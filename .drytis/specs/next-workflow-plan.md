# Qase — Next Workflow Plan (Capability-Driven)
# Updated August 7, 2026 — v2 with Definitions of Done

---

## Workstream A: Mission Context + Knowledge Layer

### A1: Mission Context Input
- Add `context` field to Mission: `{ buildPrompt?, requirements?, testCredentials?, businessGoals? }`
- POST /api/v1/missions accepts context
- Extract expected features FROM context (e.g., "Build a CRM with leads" → expects contacts, pipeline, deals)
- Context-derived expectations get confidence=1.0 (ground truth)
- Compare exploration findings against context expectations
- If context says "CRM" and heuristics say "admin" → trust context, log discrepancy

**Files**: server/missions.js, server/index.js, server/featureGap.js
**Effort**: ~1 week
**Tests**: Context parsing, expected feature extraction, context-vs-heuristic reconciliation

#### Definition of Done
- [ ] Mission creation accepts and stores buildPrompt + requirements
- [ ] Context-derived expected features are generated from buildPrompt
- [ ] Context expectations carry confidence=1.0 in the analysis
- [ ] When context and heuristics disagree, context wins and discrepancy is logged
- [ ] Feature gap analysis compares against context-derived expectations
- [ ] Report shows "expected from context" vs "detected from exploration"
- [ ] Unit tests cover context parsing + expected feature extraction + reconciliation

---

### A2: Knowledge Layer (Phase 1 — Minimal)
- Pattern store: `.qase/knowledge.json` with schema from KNOWLEDGE.md
- Knowledge Query capability: match app metadata → surface patterns BEFORE exploration
- Knowledge Write capability: extract findings → patterns AFTER quality assessment
- Orchestrator hook: knowledge hints influence capability selection

**Files**: server/knowledge.js (new), server/pipeline.js (hook), server/missions.js
**Effort**: ~1 week
**Tests**: Pattern extraction, matching, confidence accumulation

#### Definition of Done
- [ ] knowledge.js exists with PatternStore class (CRUD, match, accumulate)
- [ ] After mission_finalize: findings with severity >= medium are extracted as patterns
- [ ] Before exploration: app metadata is matched against knowledge base
- [ ] Matched patterns surface in the report under "Known Patterns Detected"
- [ ] Pattern confidence increases with occurrences (0.3 → 0.5 → 0.7 → 0.85 → 0.95)
- [ ] Knowledge query returns capability hints (e.g., "deepen auth testing")
- [ ] Unit tests cover: create, match, accumulate confidence, query by framework/auth

---

## Workstream B: Interactive Exploration Bridge

### B1: Capture Action Outcomes
- Extend captureStep() to record `outcome: { success, urlAfter?, errorCategory? }`
- After browser_open: did navigation succeed? what URL did we land on?
- After browser_fill on form submit: did we navigate to dashboard or stay on login?
- After browser_click: did page change? dialog appear?
- Store as step.outcome

**Files**: server/workflows.js, server/agent.js
**Effort**: ~1 week

#### Definition of Done
- [ ] captureStep() accepts and stores an outcome field
- [ ] browser_open outcome: { success, urlAfter }
- [ ] browser_fill on form: { success, urlAfter, errorCategory? } — detect if URL changed from login page
- [ ] browser_click outcome: { success, urlAfter?, dialogAppeared? }
- [ ] Outcomes are visible in the session detail API (capturedSteps[].outcome)
- [ ] Agent tool-end handler in agent.js populates outcomes

---

### B2: Feed Interactive Data to Intelligence Layer
- Extend extractAppInventory() to read step.outcome fields
- New inventory fields: auth.attempted, auth.succeeded, searchFunctional, formSubmitted, interactionDepth
- These REPLACE keyword guesses with verified facts

**Files**: server/featureGap.js
**Effort**: ~1 week

#### Definition of Done
- [ ] extractAppInventory reads step.outcome for auth success/failure
- [ ] auth.succeeded = true only when login action resulted in URL change away from /login
- [ ] capabilities.searchFunctional = true only when search action returned non-empty results
- [ ] Inventory reflects verified interactions, not just keyword presence
- [ ] Validation harness shows measurable accuracy improvement
- [ ] Unit tests cover outcome-based inventory extraction

---

## Workstream C: Orchestrator (Pipeline → Capabilities)

### C1: Capability Interface + Registry
- Define capability contract from CAPABILITIES.md
- Wrap each existing pipeline stage as a capability
- Orchestrator executes capabilities based on mission type + context
- Default behavior: run all (backward compatible)

**Files**: server/orchestrator.js (new), server/pipeline.js (refactor)
**Effort**: ~1 week

#### Definition of Done
- [ ] Capability interface defined: { id, name, inputs, outputs, dependencies, requiredEvidence, producesEvidence, confidence, cost }
- [ ] Each existing pipeline stage is registered as a capability
- [ ] Orchestrator resolves dependencies and executes in correct order
- [ ] Default execution runs all capabilities (backward compatible with current pipeline)
- [ ] A new capability can be added by registering it — no pipeline modification needed
- [ ] Quality Assessment and Decision Engine are separate capabilities
- [ ] Unit tests cover: capability registration, dependency resolution, selective execution

---

## Workstream D: Real App Validation

### D1: Build Test Apps (5-10)
- Known feature sets: todo (CRUD+auth), blog (CMS), store (e-commerce), dashboard (admin), landing (marketing)
- Each with documented "correct" feature set for measurement

**Effort**: ~1 week

### D2: Run + Measure
- Purpose accuracy, gap precision, false positives, workflow coverage
- Report real numbers — no predictions

**Effort**: ~1 week

### D3: Fix Top Failures
- Based on D2 metrics, fix top 3-5 patterns
- Re-measure

**Effort**: ~1 week

#### Definition of Done
- [ ] 5-10 test apps exist with documented expected features
- [ ] Each test app has a JSON spec: { purpose, expectedFeatures, expectedWorkflows }
- [ ] Validation harness runs full pipeline on each app
- [ ] Metrics table shows: purpose accuracy, gap precision, false positive rate, workflow coverage
- [ ] Top 3 failure patterns identified and fixed
- [ ] Re-measurement shows improvement

---

## Workstream E: AI Studio Contract + Live Loop

### E1: Formalize Contract
- Input: { appUrl, buildPrompt, generationId, testCredentials? }
- Output: structured report with verdict, qualityScore, improvementPrompt, fixPrompts[]
- Test against real or simulated AI Studio endpoint

**Effort**: ~1 week

### E2: Live Loop Testing
- Run generate → validate → improve → regenerate → revalidate
- Measure convergence across 3-5 iterations

**Effort**: ~2 weeks

#### Definition of Done
- [ ] API contract matches ARCHITECTURE.md spec exactly
- [ ] One complete cycle runs: create mission → start → validate → improvement prompt → iterate → revalidate
- [ ] Comparison report shows delta between iterations (bugs fixed, gaps closed, regressions)
- [ ] Convergence is tracked: does quality score improve each iteration?
- [ ] Decision Engine produces verdict: approve / regenerate / escalate / stop

---

## Workstream F: UI Redesign + Bug Fixes

### F1: Terminal/CLI Aesthetic
- Monospace fonts, terminal-style panels
- "Expert coding tool" feel per Thomas's directive

**Effort**: ~1 week

#### Definition of Done
- [ ] Dashboard uses monospace primary font
- [ ] Panels styled as terminal windows (sharp corners, thin borders, title bars)
- [ ] Chat transcript reads like terminal output
- [ ] Color scheme: dark background, green/amber accent text
- [ ] All existing functionality still works (no layout regressions)

### F2: Security Fixes
- Password change invalidates sessions
- Planning agent doesn't leak LLM info

**Effort**: ~1 week

#### Definition of Done
- [ ] Changing API token invalidates all existing sessions
- [ ] Agent responses never expose LLM model name or chain-of-thought
- [ ] Unit tests cover token rotation + info leak prevention

---

## Priority + Dependencies

```
Phase 1 (Foundation):
  A1 (Mission Context) ─┐
  A2 (Knowledge Layer) ─┤── independent, start immediately
  B1 (Capture Outcomes)─┤
  B2 (Feed to Intel)   ──┘
  C1 (Orchestrator) ────── after A+B (wraps the capabilities)

Phase 2 (Validate):
  D1-D3 (Real Apps) ────── after Phase 1

Phase 3 (Close Loop):
  E1-E2 (AI Studio) ────── after Phase 2

Phase 4 (Polish):
  F1-F2 (UI + Bugs) ────── can start anytime
```

## Effort Allocation

- 60% — Real-world validation (Workstream D)
- 30% — AI Studio integration (Workstream E)
- 10% — Foundation + incremental improvements (Workstreams A-C)
