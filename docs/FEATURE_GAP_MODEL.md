# Feature Gap Model (Phase 17)

Status: **canonical**. How Qase decides an app is "missing a feature" without
hallucinating one. Code: `server/featureGapValidation.js` (validation),
`server/uxModel.js` (FEATURE_GAP issue kind), `server/uxAssessment.js` (wiring).

Related: `docs/UX_INTELLIGENCE_MODEL.md` (checks), `docs/QUALITY_ASSESSMENT_MODEL.md`
(roll-up), `docs/PHASE_17_REPORT.md` (results).

---

## 1. The problem

"Missing feature" is the most hallucination-prone judgment in QA. A user-facing
**absence** cannot be verified the way a broken button can — you cannot screenshot
something that isn't there. Phase 17 treats FEATURE_GAP as a claim requiring an
**explicit source**, not an LLM opinion.

## 2. Rule: no explicit source → not a gap

A FEATURE_GAP issue is created only when the observation is validated against at
least one **explicit source** — a place where the app itself (or its own artifacts)
promises the feature:

1. **Advertised in-app**: nav links, menus, buttons, or copy that reference the
   feature ("Reports", "Sign In", "Invite User").
2. **Partial implementation present**: routes/view containers exist but render
   nothing, or the workflow executed steps referencing it (e.g. `#login` renders
   blank → "login form" is a gap the app itself promises).
3. **Workflow step expected it**: a mission workflow step explicitly depended on
   the feature and failed because it does not exist (as distinct from "exists but
   is broken", which is a FUNCTIONAL defect, not a gap).
4. **Data model supports it**: an entity/table/route exists whose purpose implies
   the capability (e.g. notes field on #leads implies note-taking is expected).

If none of these hold, the observation is kept as an `OBSERVATION` (surfaced in the
report, reviewable) — **never** as a FEATURE_GAP issue, and never deducted from a
dimension score.

## 3. Validation pipeline

```
observation (from checks / workflow / mission LLM)
        │
        ▼
featureGapValidation.validate(observation, { sources })
   ├─ explicit source matched?  ── yes ──► FEATURE_GAP issue (kind=FEATURE_GAP)
   │                                          with source(s) cited in evidence
   └─ no explicit source        ── ──── ──► OBSERVATION (visible, REVIEW_REQUIRED,
                                             no dimension deduction)
```

- Validation is deterministic given `(observation, sources)` — unit-tested in
  `tests/phase17-intelligence.test.js` with no browser and no LLM.
- Sources are collected during the sweep (link/button inventory, workflow step
  expectations) and recorded on the issue (`evidence[].kind = 'feature_gap_source'`)
  so reviewers can audit *why* we called it a gap.

## 4. Severity and confidence

- Severity inherits from the observation's evidence: advertised-then-dead entries
  (nav link to a blank view) are at least `high` — the app actively misleads.
  Data-model-implied gaps are at most `medium` (real, but less user-facing).
- Confidence is capped at 0.85 like all UX judgments; every FEATURE_GAP carries
  `expected` (what the source promised), `actual` (what was observed), and the
  cited source. `evidence_sufficient=false` → REVIEW_REQUIRED regardless of
  confidence.
- FEATURE_GAP issues are always `REVIEW_REQUIRED` (never AUTO_VERIFIED): absence
  claims get human eyes.

## 5. Relationship to Phase 16 findings

Phase 16 bug findings with `primary_category = FEATURE_GAP` (e.g. "signup CTAs are
non-functional — no registration flow exists") remain in the findings store; the UX
assessment cross-references them in the report's FEATURE GAPS section rather than
duplicating records. One claim, one store; UX issues link to the finding via
`relatedFindingId` when both exist.

## 6. Anti-goals

- No inferring features from competitor norms or "modern apps usually have X".
- No counting TODOs, empty buttons, or placeholders as gaps unless an explicit
  source promises more (a placeholder chart card titled "Revenue Trend" **is** an
  explicit source — the card promises data; a bare grey box is not).
- No auto-closing or auto-merging gaps; only humans REJECT or accept.
