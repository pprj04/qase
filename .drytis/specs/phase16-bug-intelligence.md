# Phase 16 — Bug Intelligence 2.0

**Goal:** Transform raw QASE findings into trustworthy, structured engineering intelligence —
evidence-backed, explainable, deterministic where possible — without touching the frozen
execution/orchestration architecture.

**Golden rule:** A model must NEVER be able to create a "verified bug" merely because an LLM
says something looks wrong. Verification requires evidence.

---

## Non-negotiable constraints

1. No changes to agent runtime, Playwright, mission/orchestration, decision engine, evidence
   graph, knowledge system (read-only reuse).
2. Backward compatible: old findings (no new fields) must remain readable/filterable; existing
   APIs keep their shapes; existing tests must still pass.
3. All new heavy processing is ASYNC post-processing (post mission finalize), never blocking
   the execution critical path.
4. Deterministic scoring for severity/priority/risk/dedup verdicts; LLM only suggests, evidence
   decides. Store LLM suggestions alongside, never overwrite observations.

---

## New module: `server/findingIntelligence.js` (deterministic engine)

### Finding lifecycle
```
DETECTED → VERIFYING → VERIFIED → CLASSIFIED → TRIAGED → REPORTED
Alternative terminal/branch states: FALSE_POSITIVE, DUPLICATE, INCONCLUSIVE,
UNREPRODUCIBLE, RESOLVED, REOPENED
```
- `finding_status` (new field) — intelligence lifecycle; legacy `status` (open→…→closed)
  remains untouched and continues to work (both drive UI).
- `review_status`: `unreviewed | confirmed | false_positive | duplicate | needs_info` —
  human review verdicts (explicit human-in-the-loop).
- `finding_status` transitions are audited into `history[]`.

### Classification (structured)
- `primary_category` — enum of 20: FUNCTIONAL, UI, UX, VISUAL, API, SECURITY, PERFORMANCE,
  ACCESSIBILITY, DATA, AUTHENTICATION, AUTHORIZATION, NAVIGATION, COMPATIBILITY, MOBILE,
  REGRESSION, FEATURE_GAP, INFRASTRUCTURE, AI_BEHAVIOR, COMPLIANCE, UNKNOWN.
- `secondary_categories[]` — same enum, max 3.
- `classification_confidence` (0–1).
- Deterministic keyword/rule classifier mapping legacy free-text `category` + title/expected/
  actual/URL. Legacy `category` string is preserved (never overwritten); normalized into the
  enum + stored separately.

### Severity (structured + explainable)
- `severity` stays the 5-value enum; NEW: `severity_confidence`, `severity_rationale`.
- Deterministic severity calculator using impact signals: workflow-blocking, data loss, data
  exposure, auth-blocking, production-readiness, workaround, cosmetic-only, security-related,
  frequency (from reproducibility).
- Deterministic evidence-derived override: if signals contradict LLM severity by ≥2 levels,
  store computed severity + rationale; else keep agent severity (backed by rationale).
- INFO-level for pure cosmetic/no-impact observations.

### Priority (separate from severity)
- P0|P1|P2|P3 from a deterministic weighted model: severity weight, workflow criticality,
  user impact (reproduction rate), security implication, confidence, release risk, frequency.
- `priority_rationale`. No blind CRITICAL→P0 mapping (needs evidence).

### Confidence (evidence-based, explainable)
- `confidence` (0–1) + `confidence_reason` (structured: signals + contributions).
- Evidence signals scored deterministically: reproduced / repeated reproduction /
  deterministic failure / console error / network error / DOM evidence / screenshot evidence /
  expected-vs-actual mismatch / API response / multiple observations. LLM self-assessment is
  NOT a signal.
- Levels: LOW <0.40, MEDIUM <0.70, HIGH <0.90, VERY_HIGH ≥0.90.

### Reproducibility
- `reproducibility`: REPRODUCIBLE | INTERMITTENT | UNREPRODUCIBLE | UNKNOWN (maps from legacy
  confirmed/unconfirmed/intermittent strings).
- `reproduction_attempts`, `successful_reproductions`, `reproduction_rate`.
- Revalidation iterations update attempts (mission iterations that re-observe the finding);
  drives reproducibility + confidence; rate affects triage.

### Evidence sufficiency gate
- `evidence_sufficiency` computed from typed evidence refs: {required, present, missing,
  suffices (bool), reasons}.
- Rules: FUNCTIONAL/API findings need ≥2 evidence items of ≥2 distinct source types;
  SECURITY & AUTHENTICATION require console/network/API evidence or DOM state proof; others
  need ≥1 typed evidence item. Zero typed evidence → NEVER VERIFIED.
- Finding must link to evidence (existing graph via `GET /api/findings/:id/evidence` logic —
  reuse evidenceGraph queries) — `evidence_refs[]` (typed) stored on finding.

### Expected vs Actual
- Reuse existing `expected`/`actual` (+ `observed`, `impact`); add `expected_uncertain` (bool)
  when no requirement/mission context backs the expectation; add `expected_source` (enum:
  requirement | mission_context | app_behavior | workflow_expectation | unknown).

### Workflow/feature relationships
- `workflow_id`, `feature_id` (nullable), `page` (derived from url path), `component`/
  `api_endpoint` (from evidence targets when confidently derivable).
- UNKNOWN (null) when not confidently derivable — never invented.

### Duplicate detection (strengthened, reuse correlation engine)
- Reuse `duplicateSuppression.computeFindingSimilarity` on GLOBAL store findings (new function
  that feeds the existing similarity engine), plus error signature (normalized error text),
  DOM target, API endpoint, console/network error match.
- Verdicts: UNIQUE | DUPLICATE | POSSIBLE_DUPLICATE.
- `duplicate_of` (canonical id) + `duplicate_candidates[]` (for POSSIBLE tier).
- POSSIBLE_DUPLICATE is NEVER auto-merged — requires review (review_status=duplicate action or
  strong evidence: similarity ≥ 0.90 AND same error signature).
- Merged provenance preserved: `duplicate_provenance` {originalIds, sessions, missions,
  evidenceCount}.

### Root cause
- `root_cause_category` enum: ui_logic, state_management, api_failure, authentication,
  authorization, data_validation, routing, configuration, integration, browser_compat,
  backend_failure, infrastructure, unknown. Default unknown — never guessed.
- `root_cause_confidence`; evidence-required promotion beyond unknown (console error/stack,
  network failure, API response, workflow step evidence linking).
 `root_cause_potential[]` — candidate causes (explicitly "potential").

### Risk model (deterministic, documented)
- `risk` (LOW|MEDIUM|HIGH|CRITICAL) + `risk_reason`: f(impact=severity+security+data-loss
  signals, likelihood=reproduction rate+user scope, confidence). Exact formula in
  docs/BUG_INTELLIGENCE_MODEL.md.

### Developer intelligence summary
- `dev_summary` object: title, category, severity, priority, confidence, reproducibility,
  expected, actual, impact, evidence count/types, affected workflow/feature, potential root
  cause, suggested investigation, recommended fix, regression risk — rendered from existing
  fields + deterministic templates (no fake code fixes; reuse existing `recommendation`/
  `fixPrompt`/devIntelligence content).

### Finding quality score
- `quality` sub-object: {evidence, reproduction, classification, impact, rootCause} — each
  0–1; findingConfidence = weighted blend, shown with per-dimension breakdown in UI.

### Secret redaction
- Deterministic redactor for known patterns (passwords, api keys, tokens, cookies, bearer,
  secrets, private credentials) applied to evidence payloads/reports/exports/logs/UI.
  Applied at read/render time + in evidence collection (defense in depth) — read paths
  redact before serialization.

### Async enrichment
- `enrichFindingBatch(sessionId|missionId)` — runs post-finalize via setImmediate +
  per-finding try/catch; measures latency; emits SSE `finding_enriched`. Failure never
  blocks finalize or mission completion.
- Metrics: classification_latency, duplicate_detection_latency, enrichment_latency via
  existing metrics mechanism (server/metrics.js if present; else inline counters + /api/metrics).

## API extensions (additive, backward compatible)

| Endpoint | Purpose |
|---|---|
| `PATCH /api/findings/:id/classification` | set primary/secondary categories + confidence (validated enum) |
| `PATCH /api/findings/:id/severity` | severity + confidence + rationale |
| `PATCH /api/findings/:id/priority` | priority P0–P3 |
| `PATCH /:id/review` | review_status transitions (confirmed/false_positive/duplicate/needs_info) + comment |
| `GET /:id/duplicates` | duplicate candidates + verdict + provenance |
| `GET /:id/related` | related findings (shared workflow/feature/page/signature) |
| `GET /:id/affected-workflow` | workflow linkage resolution |
| `GET /:id/affected-feature` | feature linkage resolution |
| `GET /api/findings/duplicates` | global duplicate overview (canonical groups) |
| `GET /api/findings/:id/evidence` | (existing) now returns evidence_refs + sufficiency |
| `GET /api/findings` filters | + category, priority, finding_status, review_status, workflow, feature, reproducibility, min_confidence |
| `GET /api/findings/grouped` | counts grouped by category/severity/priority/workflow/risk (dedup-aware) |

All behind existing `requireApiToken`. No changes to `/api/v1/*` contract except additive
fields in mission report JSON (documented).

## Store / schema (additive, migration in code with marker)

New optional fields on finding objects (undefined-when-absent, whitelist-patched, same
precedent as Evidence Engine block):
`finding_status, review_status, primary_category, secondary_categories,
classification_confidence, severity_confidence, severity_rationale, priority,
priority_rationale, confidence_reason, reproducibility(new enum), reproduction_attempts,
successful_reproductions, reproduction_rate, risk, risk_reason, root_cause_category,
root_cause_confidence, root_cause_potential, workflow_id, feature_id, page, component,
api_endpoint, duplicate_of, duplicate_candidates, duplicate_provenance, evidence_refs,
evidence_sufficiency, expected_uncertain, expected_source, quality, dev_summary,
enriched_at, intelligence_version`.

Migration: lazy per-record upgrade on load (`ensureIntelligenceFields` — fills defaults
from existing data, e.g. mapping legacy reproducibility strings) — no rewrite of
findings.json beyond normal debounced saves; old records readable at all times. A one-time
backfill marker `.qase/.finding-intelligence-backfill` guards a full-store backfill of
derived fields (skippable, runs on boot after migrateFromSessions).

## UI changes (Bugs Hub + session findings, additive)

- Finding card: TITLE, CATEGORY chip, SEVERITY badge, PRIORITY badge, CONFIDENCE %,
  STATUS badge, Reproducible n/n, Expected/Actual excerpt, Evidence count, Workflow name.
- Actions: View Evidence (existing), Review (confirm/FP/duplicate/needs-info), Revalidate.
- New filters: Category, Severity, Priority, Status (lifecycle), Confidence, Workflow,
  Feature, Reproducibility, Review status.
- No redesign of overall QASE UI; existing views keep working.

## Reporting

- `GET /api/findings/grouped` + report builders group findings by category/severity/priority/
  workflow/feature/risk; duplicates excluded from separate counts (canonical only, dup counts
  reported separately as "duplicates of canonical").
- Mission report markdown gains a grouped summary section.

## Testing strategy

- Unit (new `tests/phase16-intelligence.test.js`): classification mapping, severity calc,
  priority calc, confidence calc + explainability, reproducibility mapping, risk calc,
  duplicate detection verdicts (UNIQUE/POSSIBLE/EXACT), lifecycle transitions, evidence
  sufficiency gate, expected/actual uncertainty, redaction.
- Integration (new `tests/phase16-api.test.js`): finding create→enrich→review→duplicate
  linking→evidence retrieval→workflow/feature linking→grouped report; auth still enforced;
  backward compat (old-shape finding readable + filterable).
- E2E (manual via tester + `.drytis` runner): findings appear after mission, evidence,
  classification/severity/priority present, duplicates grouped, FPs separate, review flow,
  revalidate, report grouping.
- Regression: full existing suite before (baseline recorded) and after; Phase 0 benchmark
  rerun with before/after precision/recall/dup-rate comparison.

## Acceptance criteria (checkboxes)

- [ ] Every actionable finding has structured classification (primary enum + confidence).
- [ ] Severity structured & explainable (confidence + rationale stored).
- [ ] Priority separate from severity, deterministic model.
- [ ] Confidence evidence-based with reason breakdown.
- [ ] Reproducibility tracked (attempts/success/rate) and affects triage.
- [ ] Verified findings have sufficient typed evidence (gate enforced).
- [ ] Expected vs actual represented; uncertainty flagged when unknown.
- [ ] Workflow/feature linkage where derivable; UNKNOWN otherwise.
- [ ] Duplicate detection on global store with UNIQUE/DUPLICATE/POSSIBLE verdicts.
- [ ] Possible duplicates not blindly merged.
- [ ] Root cause defaults to unknown; promotion requires evidence.
- [ ] Developer-facing recommendations generated (no fake code).
- [ ] Findings groupable by category/severity/priority (+workflow/risk).
- [ ] False positives represented separately (review_status + lifecycle).
- [ ] Existing bug review functionality still works.
- [ ] Existing evidence access still works.
- [ ] Existing reports still work.
- [ ] Existing missions still work.
- [ ] Existing APIs backward compatible.
- [ ] No authn/authz regression (new routes behind requireApiToken).
- [ ] No sensitive data leakage (redaction on evidence/report/UI paths).
- [ ] Existing test suite passes (baseline comparison).
- [ ] New Phase 16 tests pass.
- [ ] Phase 0 benchmark rerun; precision/recall/dup-rate compared.
- [ ] Mission runtime not materially regressed (async enrichment; measured).
