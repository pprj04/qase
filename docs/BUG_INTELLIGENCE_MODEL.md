# Bug Intelligence Model — Phase 16

> Deterministic, documented model for turning raw agent findings into
> trustworthy engineering intelligence. **Version:** `phase16-v1`
> **Engine:** `server/findingIntelligence.js` (pure functions, no LLM calls).

## Design Principle

An LLM (the QA agent) **reports observations**. The deterministic engine
**derives** classification, severity, priority, confidence, reproducibility,
duplication, risk, and lifecycle state from evidence and signals — the same
inputs always produce the same outputs. **An LLM can never create a
"confirmed bug" merely by asserting that something looks wrong.**

---

## 1. Finding Lifecycle

```
DETECTED → VERIFYING → VERIFIED → CLASSIFIED → TRIAGED → REPORTED
                │           │
                ├──→ INCONCLUSIVE      ├──→ FALSE_POSITIVE
                ├──→ UNREPRODUCIBLE    ├──→ DUPLICATE
                ├──→ FALSE_POSITIVE    ├──→ REOPENED
                └──→ DUPLICATE         └──→ RESOLVED
```

| State | Meaning | Entered when |
|---|---|---|
| `DETECTED` | Raw finding recorded | Creation / re-derived when evidence insufficient |
| `VERIFYING` | Evidence collection in progress | Agent still testing, or review `confirmed` |
| `VERIFIED` | Evidence sufficiency passed | ≥2 typed evidence items **or** deterministic reproduction, never directly from `DETECTED` (see gate below) |
| `CLASSIFIED` | Structured classification accepted | Human/agent sets primary category |
| `TRIAGED` | Priority assigned | Human sets P0–P3 |
| `REPORTED` | Exported to a report | Report generation includes it |
| `FALSE_POSITIVE` | Wrongly flagged | Review verdict `false_positive` |
| `DUPLICATE` | Already reported elsewhere | Manual merge (never automatic for `POSSIBLE_DUPLICATE`) |
| `INCONCLUSIVE` | Not enough info, no evidence at all | Derived |
| `UNREPRODUCIBLE` | Attempted, never reproduced | `attempts ≥ 1 && successful === 0` |
| `REOPENED` | Reopened after resolution/FP | Human action |

**Evidence gate:** `DETECTED → VERIFIED` is not in the transition table. A
finding must pass through `VERIFYING`, and `VERIFIED` is only derived when
`evidence_sufficiency.sufficient === true`. The API rejects jumps with HTTP
400 and an explanatory message.

### Outcomes (review verdicts)

`unreviewed | confirmed | false_positive | duplicate | needs_info`

---

## 2. Classification (19 + UNKNOWN categories)

Primary category + up to 3 secondary categories + `classification_confidence`
(0–1). Stored in dedicated fields — **separate from the observation**
(`title/expected/actual/observed` are never overwritten by classification).

| Category | Key signals (deterministic keyword rules over title/category/actual/observed) |
|---|---|
| `FUNCTIONAL` | fails, broken, does nothing, error, crash, submission… |
| `UI` | render, display, layout, misaligned, overlap, missing element |
| `UX` | confusing, unclear, hard to, no feedback, unexpected behavior |
| `VISUAL` | css, style, color, font, spacing, border |
| `API` | 4xx/5xx status, endpoint, response body, network request failures |
| `SECURITY` | xss, injection, token leak, exposed data, no validation on sensitive input |
| `PERFORMANCE` | slow, timeout, latency, memory, cpu, freezes |
| `ACCESSIBILITY` | aria, screen reader, contrast, keyboard navigation, alt text |
| `DATA` | persistence, saves but doesn't store, wrong data, mismatch, stale |
| `AUTHENTICATION` | login, logout, sign in, credentials, session |
| `AUTHORIZATION` | permission, role, access denied, admin-only |
| `NAVIGATION` | link, route, redirect, 404, page not found |
| `COMPATIBILITY` | browser, safari, firefox, edge, viewport size |
| `MOBILE` | responsive, mobile, touch, small screen |
| `REGRESSION` | used to work, previously, after update |
| `FEATURE_GAP` | missing feature, no X, not implemented, should exist |
| `INFRASTRUCTURE` | build, deploy, container, dns, certificate |
| `AI_BEHAVIOR` | llm, model, prompt, hallucination, agent |
| `COMPLIANCE` | gdpr, privacy policy, terms, cookie consent |
| `UNKNOWN` | no signals matched (confidence ≤ 0.3) |

Legacy free-text categories map via `normalizeCategory` (e.g. `auth` →
`AUTHENTICATION`, `forms` → `FUNCTIONAL`). A generic legacy value (`general`,
`unknown`, `other`, `misc`, empty) never masks keyword-derived classification.

`classification.method` records provenance: `keyword_rules | legacy_category |
explicit | fallback_unknown`.

---

## 3. Severity (evidence/impact-signal driven)

Severity starts from the agent's raw severity but is **adjusted by signals**,
never by model intuition:

| Signal | Direction |
|---|---|
| `data_loss`, `data_exposure`, `security_related` | floor at `high`; data exposure/security → floor `critical` candidate (+1.2/+1.0 weight) |
| `blocks_core_flow` (checkout/login/submit/pay dead) | +1.0 |
| `affects_many_users` (reproduction rate ≥ 0.8 measured) | +0.6 |
| `console_error` / `network_error` present in evidence | +0.3 / +0.4 |
| `visual_only` (pure styling, function works) | −0.5, floor `low` |
| `error_override` | one-step upgrade when security/exposure signals present |

Final severity thresholds on the weighted score: `critical ≥ 1.8`,
`high ≥ 0.9`, `medium ≥ 0.4`, `low > 0`, else `info`.

Every severity carries `severity_confidence` (0–1) and `severity_rationale`
(enumerated signals that fired, human-readable).

---

## 4. Priority (separate from severity, P0–P3)

Priority considers **five inputs**: severity, business impact, frequency,
security relevance, and confidence. **No blind CRITICAL → P0 mapping.**

```
score = sevW (info:0, low:1, medium:2, high:3, critical:4) × 2
      + business impact (impact text / core-flow signals: 0–3)
      + frequency (reproduction rate × 2, only when measured)
      + security (+3)
      + confidence (× 1)
P0: score ≥ 8.5 AND evidence gate: sevW ≥ 3 AND (security OR rate ≥ 0.8) AND confidence ≥ 0.7
P1: score ≥ 6.5  (or demoted P0 — rationale says "gate")
P2: score ≥ 4
P3: otherwise
```

A critical finding without evidence backing stays P1 (rationale explains the
demotion). `priority_rationale` always lists the contributing factors.

---

## 5. Confidence (explainable, evidence-based)

```
level: LOW < 0.4 ≤ MEDIUM < 0.7 ≤ HIGH < 0.9 ≤ VERY_HIGH
```

Additive signal model, baseline 0.05, capped 0.95, **LLM self-confidence is
deliberately not a signal**:

| Signal | Weight | Fires when |
|---|---|---|
| `reproduced` | +0.25 | reproducibility REPRODUCIBLE and successes ≥ 1 |
| `repeated_reproduction` | +0.10 | successes ≥ 2 or attempts ≥ 2 |
| `deterministic_failure` | +0.10 | rate = 1.0 and attempts ≥ 2 |
| `console_error` | +0.15 | console-type evidence with error text |
| `network_error` | +0.15 | network evidence with 4xx/5xx |
| `api_response_evidence` | +0.08 | api_response evidence exists |
| `dom_evidence` | +0.08 | dom evidence exists |
| `screenshot_evidence` | +0.08 | screenshot/video evidence exists |
| `expected_actual_mismatch` | +0.15 | both expected and actual non-empty |
| `multiple_observations` | +0.10 | ≥2 observations or ≥2 distinct sources |
| `legacy_repro_claimed` | +0.02 | legacy `confirmed` flag only (no attempts data) |

`confidence_reason` stores `{ level, signals[], contributions[[signal, weight]] }`
— every score is fully explainable and reproducible. **A confident LLM alone
moves confidence by exactly 0.** Confidence can only rise with reproducibility
or typed evidence.

---

## 6. Reproducibility

```
REPRODUCIBLE | INTERMITTENT | UNREPRODUCIBLE | UNKNOWN
```

- `reproduction_attempts` (int ≥ 0) — total attempts
- `successful_reproductions` (int ≥ 0) — successful ones
- `reproduction_rate` = successes/attempts, `null` when attempts = 0 (never
  fabricated)
- `successes > attempts` (impossible data) → `UNKNOWN`, rate `null`
- Legacy values map: `confirmed→REPRODUCIBLE`, `intermittent→INTERMITTENT`,
  `unconfirmed→UNKNOWN`

Every manual/API `POST /revalidate` increments attempts; successes increment
when the deterministic enrichment verifies the finding.

---

## 7. Evidence Sufficiency Gate

A finding **cannot become VERIFIED** without sufficient evidence:

```js
{
  sufficient: boolean,
  reasons: string[],       // why not sufficient
  present: { count, types[], sources[] },
  required: { minItems, requiredTypes, minSources },
}
```

Per-category requirements (deterministic):

| Category | minItems | required types (any-of) | minSources |
|---|---|---|---|
| FUNCTIONAL | 2 | console ∨ network ∨ api_response ∨ dom | 1 |
| API | 1 | network ∨ api_response | 1 |
| SECURITY | 2 | console ∨ network ∨ api_response ∨ dom | 1 |
| ACCESSIBILITY | 1 | dom ∨ screenshot | 1 |
| UI/VISUAL | 1 | screenshot ∨ dom | 1 |
| default | 1 | any | 1 |

EVIDENCE_TYPES produced by the evidence engine: `step_outcome`,
`finding_detail` today; the gate also recognizes `console`, `network`,
`api_response`, `dom`, `screenshot`, `video`, `log`.

---

## 8. EXPECTED / ACTUAL / IMPACT (no hallucinated expectations)

- `expected` / `actual` come from the agent or human; `impact` is the business
  consequence.
- `expected_source` records provenance: `agent_claimed | spec | human |
  ground_truth`.
- When the agent asserts expected behavior with no spec basis, the engine sets
  `expected_uncertain = true` — uncertainty is marked, never silently trusted.
- `assessExpectedActual` flags: empty actual, identical expected/actual,
  expected with no grounding — each lowers confidence contribution and is
  surfaced in `evidence_sufficiency.reasons`.

---

## 9. Workflow → Feature → Page → Component → API Linkage

`deriveLinkage` maps a finding onto the product model. Unknown is stored as
`UNKNOWN`/`null` — **never invented**:

- `workflow_id` — from finding's `workflowId` (workflow-engine findings carry
  it) or sessionId → workflow resolution; else `UNKNOWN`
- `feature_id` — intent-model feature match on URL/title; else `UNKNOWN`
- `page` — normalized URL pathname
- `component` — from evidence `target` selectors (heuristic: id/class)
- `api_endpoint` — from network evidence URLs on the finding
- `linkage_confidence` + `linkage_basis` (which signals produced the linkage)

API: `GET /api/findings/:id/affected-workflow`, `/:id/affected-feature`.

---

## 10. Duplicate Detection

`compareForDuplicates(a, b)` — weighted similarity, fully deterministic:

| Signal | Weight |
|---|---|
| title-token jaccard | ×0.5 |
| title+actual+observed jaccard | ×0.5 |
| `same_page` (normalized path) | +0.15 |
| `same_category` | +0.10 |
| `same_workflow` | +0.15 |
| `same_feature` | +0.10 |
| `same_error_signature` (signature jaccard ≥ 0.8) | +0.15 |
| `same_api_endpoint` | +0.15 |
| `same_component` | +0.10 |

Verdicts: `UNIQUE` (< 0.38) · `POSSIBLE_DUPLICATE` (0.38–<0.72) ·
`DUPLICATE` (≥ 0.72, or error-signature ≥ 0.9 with similarity ≥ 0.82).

- `POSSIBLE_DUPLICATE` **never auto-merges** — surfaced as a candidate with
  similarity score; a human merges via `POST /api/findings/:id/duplicates`.
- On merge, `duplicate_provenance` records `{ originalIds, sessions, missions,
  evidenceCount, mergedAt }` — nothing is deleted; the duplicate stays
  queryable but is excluded from canonical grouped counts.
- Canonical selection: earliest `ts`, deterministic tie-break on id.
- The legacy suppressor (`duplicateSuppression.js`, threshold 0.38 title+URL)
  still prevents *creation-time* duplicates; Phase 16 adds *post-hoc*
  clustering with human confirmation.

---

## 11. Root Cause Intelligence

`root_cause_category` ∈ `known_bug | configuration | data_issue | environment
| design_flaw | external_dependency | unknown`. Derived **only** when evidence
supports it (e.g. 5xx network evidence → `external_dependency`; console
TypeError on a handler → `known_bug` at low confidence). Otherwise `unknown`
— **never fabricated**. `root_cause_confidence` + `potential_causes[]` (from
evidence types) accompany it.

---

## 12. Developer-Facing Summary

`dev_summary` = title, category, severity, priority, confidence,
reproducibility, expected/actual/impact, evidence (count + types),
workflow/feature/page/api_endpoint, potential root cause, suggested
investigation steps (derived from evidence types — e.g. "inspect network
response for /api/payment"), recommendedFix (the agent's suggestion,
redacted). **No fake code fixes are generated** — recommendations are
investigation guidance, and any fix suggestion is clearly labeled as the
agent's own (`dev_summary.recommended_fix_source = 'agent'`).

---

## 13. Finding Quality Score

Per-dimension (never collapsed into one number without visibility):

```
quality = {
  evidence:      min(1, evCount/3)×0.6 + sufficient?0.4,
  reproduction:  REPRODUCIBLE 1.0 | INTERMITTENT 0.6 | UNREPRODUCIBLE 0.2 | UNKNOWN 0.4,
  classification: classification_confidence,
  impact:        severity_confidence,
  rootCause:     root_cause_confidence (0.1 when unknown),
  overall:       weighted blend (0.35/0.2/0.2/0.15/0.1)
}
```

---

## 14. Risk Model (deterministic)

```
LOW < 0.3 ≤ MEDIUM < 0.6 ≤ HIGH < 0.85 ≤ CRITICAL
risk = max(
  severity weight × evidence multiplier,   // severity must be evidence-backed
  security exposure term,                  // security signals floor at HIGH
)
```

| Risk | Meaning |
|---|---|
| `LOW` | cosmetic / informational |
| `MEDIUM` | real defect, workaround exists |
| `HIGH` | core functionality degraded |
| `CRITICAL` | data loss/exposure or core flow blocked with evidence |

Risk is displayed with `risk_rationale` (the max-term that produced it).

---

## 15. Security — Redaction

All evidence, summaries, reports, logs, and prompts pass through
`redactString` / `redactEvidenceItem` (9 pattern families: password
assignments, api keys/secrets/tokens, bearer tokens, cookie values, `sk-`
keys, AWS keys, JWTs, JSON secret values, PEM blocks). Redaction happens
**before storage** on agent-reported fields and again at API render time for
evidence items. See `FINDING_REVIEW.md` for the review flow.

---

## 16. Async Post-Processing & Metrics

Enrichment runs `setImmediate` after mission finalize — **never blocks
mission completion**. Latency counters (classification, duplicate detection,
enrichment) and outcome counters (detected/enriched/verified/duplicate/FP)
are exposed at `GET /api/bug-intelligence/metrics`:

- `findings_detected`, `findings_enriched`, `findings_verified`,
  `findings_false_positive`, `findings_duplicate`
- `verification_rate`, `false_positive_rate`, `duplicate_rate`
- `classification_latency_ms {avg,max}`, `duplicate_detection_latency_ms`,
  `enrichment_latency_ms`

---

## 17. Versioning & Compatibility

- `INTELLIGENCE_VERSION = 'phase16-v1'` stamped on every enriched finding.
- All new fields are **additive**; old findings get defaults on read
  (`finding_status='DETECTED'`, `review_status='unreviewed'`,
  `primary_category` derived lazily).
- Legacy status (`open/in_testing/resolved/closed`) is untouched and
  orthogonal to the intelligence lifecycle.
- APIs are backward compatible: old clients see old fields unchanged.
