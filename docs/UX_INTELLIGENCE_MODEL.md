# UX Intelligence Model (Phase 17)

Status: **canonical** — this document is the deterministic specification of how Qase
detects, scores, and reviews UX issues. No number in this file is decorative; every
formula below maps 1:1 to code in `server/uxChecks.js`, `server/uxSweep.js`,
`server/uxModel.js`, and `server/uxAssessment.js`.

Related documents:
- `docs/QUALITY_ASSESSMENT_MODEL.md` — how per-dimension UX scores roll up into an
  overall application quality score.
- `docs/FEATURE_GAP_MODEL.md` — how "missing feature" observations are validated
  against explicit sources before they become FEATURE_GAP issues.
- `docs/PHASE_17_REPORT.md` — measured results of this model across the benchmark suite.

---

## 1. Purpose and boundaries

UX Intelligence answers one question: **is this application usable, coherent, and
accessible — and can we prove it?** It is deliberately narrower than a human UX audit:

- It evaluates **what the running app renders and does** (DOM, layout, navigation,
  feedback, responsiveness), not business strategy, copy quality, or brand.
- It never speculates beyond evidence. Where a judgment is subjective, the check
  stays UNVERIFIED and the issue (if produced) stays `REVIEW_REQUIRED`.
- **LLM opinion alone never marks anything VERIFIED.** All verification in this model
  is either deterministic (measurable DOM/layout facts) or explicit human review.

## 2. The sweep (evidence collection)

`server/uxSweep.js` drives a real browser (Chromium via Playwright, same transport
as missions) through every page discovered during the mission:

- **Three viewports per page**: desktop 1280×800, tablet 768×1024, mobile 375×812.
- Captures per page/viewport: full DOM snapshot (text-normalised), headings outline,
  interactive inventory (links/buttons/inputs with text, role, size), layout metrics
  (overflow, scrollWidth vs clientWidth), navigation structure, form inventory,
  console messages, HTTP failures, focusability of interactive elements, dead-end
  detection, images (alt presence, natural size), touch target sizes.
- **Never throws.** Transport errors become `dataCollection: { ok: false, error }`
  on the page record; pages that fail simply do not produce checks, and dimension
  confidence degrades via the scope factor instead of crashing the assessment.
- Runtime guardrail: per-page timeout 45 s, per-assessment 300 s; partial sweeps
  persist with `partial: true`.

### 2.1 Evidence contract

Every issue carries structured evidence: `expected`, `actual`, and concrete evidence
records (`{kind, url, viewport, detail, measured}`). Checks attach the measured values
that triggered them (e.g. `scrollWidth: 602`, `clientWidth: 375`) so a reviewer can
re-verify any issue from the record alone. Issues without sufficient evidence are
demoted (`evidence_sufficient: false`) and cannot be AUTO_VERIFIED.

**Evidence invariant**: a VERIFIED issue needs ≥2 evidence refs (or 1 screenshot).
Site-level checks (cross-page consistency) therefore emit per-page refs — every page
that exhibited the signal contributes its own `dom` record — never a single summary
ref. Transport-error strings in sweep metadata pass through the same redaction as all
other sweep output.

## 3. Checks (deterministic UX signals)

24 page checks across 6 dimensions, plus cross-page consistency analysis:

| Dimension | Example checks |
|---|---|
| NAVIGATION | `nav_element`, `dead_end`, `back_forward`, `page_title`, `site_consistency` |
| CLARITY | `heading_structure` (single h1), `heading_hierarchy`, `page_title_matches_content` |
| FEEDBACK | `console_errors`, `http_failures`, `feedback_on_action` (heuristic, mostly UNVERIFIED) |
| RESPONSIVENESS | `horizontal_overflow`, `viewport_meta`, `touch_targets`, `table_overflow` |
| ACCESSIBILITY | `image_alt`, `interactive_names`, `document_lang`, `positive_tabindex`, `heading_structure`, `viewport_zoom`, `landmarks`, `focus_order` |
| CONSISTENCY | `site_consistency` (cross-page: same h1 wording, same nav order) |

Check statuses: `PASS` / `ISSUE` / `UNVERIFIED` (insufficient signal — never counts as
evidence for or against).

- Checks are pure functions over `pageData` records; fully unit-tested without a
  browser (`tests/phase17-ux-checks.test.js`).
- UNVERIFIED is the honest default when the DOM doesn't let us decide (e.g. no
  `expected` wording exists for a heuristic feedback check).

## 4. Dimension scoring

Per dimension, starting at 100, minus deductions:

```
deduction = Σ_checkId  severityWeight × repetitionFactor(count)
  severityWeight: critical 25 | high 15 | medium 8 | low 3 | info 0.5
  repetitionFactor(count) = min(3, sqrt(count))     # 1→1.0, 4→2.0, 9→3.0 (capped)
score = max(0, round(100 − deduction))
```

- Severity weights align with Phase 16 devIntelligence so scores are comparable
  across phases.
- Repetition dampening: an issue appearing on many pages hurts more than once, but
  sub-linearly; the cap (×3) keeps one noisy check from zeroing a dimension.
- **PASS checks never add score back.** Score measures issues found, not conformance
  achieved.

### 4.1 Dimension confidence

```
coverage    = decisive checks / total checks            (decisive = PASS|ISSUE)
scope       = pages with any data / pages attempted     (transport success)
confidence  = clamp(coverage × scope, 0.30, 0.95)       when any decisive data exists
confidence  = 0 otherwise
```

Confidence answers "how much of this page set did we actually see and decisively
measure?" A 100 score with confidence 0.35 means "the little we saw looked fine",
not "the app is excellent" — the UI renders confidence as a muted badge and the
quality model (§7) weights dimension scores by confidence.

## 5. Issues

`buildIssuesFromChecks` groups ISSUE results by `checkId|url` (viewports merged with
occurrence counts). Each issue:

- `kind`: FUNCTIONAL_DEFECT / UX_ISSUE / ACCESSIBILITY_ISSUE / FEATURE_GAP /
  OBSERVATION / RECOMMENDATION (deterministic by dimension/check family).
- `severity`: max severity across occurrences (critical > high > medium > low > info).
- `confidence`: strong with multiple viewports agreeing or strong evidence kinds;
  **hard-capped at 0.85** for UX judgments — measurable facts (e.g. overflow) can be
  more confident than taste, but we never claim certainty about UX.
- `evidence[]`, `expected`, `actual`, `impact`, plus `repetition` (viewports/pages).
- Deterministic issue IDs (`uxi_<checkId[:4]>_<rand>` per record; grouped + listed in
  creation order) and stable sort order for testability.

### 5.1 Issue review states — LLM never auto-verifies UX

```
AUTO_VERIFIED     only for deterministic, measurable facts
                  (RESPONSIVENESS overflow numbers, ACCESSIBILITY image_alt with
                  counts, NAVIGATION dead_end with measured link inventory)
REVIEW_REQUIRED   default for subjective dimensions (CLARITY, CONSISTENCY) and any
                  issue whose evidence_sufficient = false
REJECTED          human-only state — the API refuses system transitions into it
```

`PATCH /api/v1/missions/:id/ux/issues/:issueId/review` enforces the machine:
`REJECTED` is reachable **only** by a human review call (`by: 'human'`). The
state machine rejects system transitions out of REJECTED (409 `invalid_transition`)
and rejects state values outside the enum (400). This invariant ("LLM opinion alone
never VERIFIED") is enforced in code and covered by integration tests.

## 6. Friction (workflow-level UX)

`server/uxFriction.js` analyses mission workflow sessions — steps that succeeded but
with measurable friction (long retries, recovery actions, slow timings, missed fast
paths). Friction records feed QUALITY's EFFICIENCY dimension and produce
RECOMMENDATION-kind issues; they never deduct from a UX dimension without a matching
deterministic check.

## 7. Roll-up

The ux panel consumes exactly these records; QUALITY_ASSESSMENT_MODEL.md defines the
weighted roll-up (§5 there) of UX dimensions plus dev-intelligence dimensions into
the overall quality score. UX issues are stored **separately** from bug findings
(`​.qase/ux-assessments.json`), never mixed into the findings store.

## 8. Limits (measured, not assumed)

Measured across the Phase 17 benchmark (see PHASE_17_REPORT.md):

- The sweep does not execute arbitrary interaction flows; FEEDBACK checks are
  intentionally conservative (most UNVERIFIED) — action-feedback is judged from
  mission step evidence, not sweeps.
- Heuristic checks (touch targets on elements without on-screen rect) can be
  UNVERIFIED; these never deduct.
- Cross-page consistency requires ≥2 pages with data; single-page apps get UNVERIFIED.
- Assessments are point-in-time; re-run via `POST /api/v1/missions/:id/ux-assess`.
