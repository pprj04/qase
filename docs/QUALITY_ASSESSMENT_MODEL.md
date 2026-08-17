# Quality Assessment Model (Phase 17)

Status: **canonical**. The deterministic roll-up that turns Phase 16 bug
intelligence + Phase 17 UX evidence into a single application quality score.
Code: `server/qualityAssessment.js`.

Related: `docs/UX_INTELLIGENCE_MODEL.md` (dimension scoring), `docs/BUG_INTELLIGENCE_MODEL.md`
(finding severity/risk), `docs/PHASE_17_REPORT.md` (measured results).

---

## 1. Output

```
qualityScore: 0–100            single comparable number
band: A | B | C | D            A≥85, B≥70, C≥55, D<55
dimensions: per-dimension { score, confidence, weight, deduction drivers }
dimensionsMissing: [names]     dimensions with zero data (never scored as 0!)
overallConfidence: 0–1         how much we actually measured
verdict: human-readable summary line (deterministic template)
```

## 2. The seven dimensions and weights

| # | Dimension | Source | Weight |
|---|-----------|--------|-------|
| 1 | FUNCTIONAL | Phase 16 verified findings + workflow step outcomes | 3 |
| 2 | UX | UX dimension scores (NAVIGATION, CLARITY, RESPONSIVENESS roll-up) | 3 |
| 3 | ACCESSIBILITY | UX checks (alt text, focusability, landmarks) | 1.5 |
| 4 | FEATURE_COMPLETENESS | validated feature gaps vs advertised surface (FEATURE_GAP_MODEL.md) | 2 |
| 5 | NAVIGATION | UX checks (nav, dead-ends, back/forward, titles) | 1 |
| 6 | ERROR_HANDLING | console/HTTP failure density + feedback checks | 1 |
| 7 | WORKFLOW_RELIABILITY | workflow failure ratio + friction (uxFriction.js) | 2 |

Raw weights sum to 13.5 and are normalized internally (`DIMENSION_WEIGHTS` in
`server/qualityAssessment.js`) — the roll-up divides by the sum of applied weights,
so missing dimensions degrade confidence, not score.

## 3. Roll-up formula

Per dimension d:

```
S_d   = dimension score (0–100) from its own model
C_d   = dimension confidence (0–1) from its own model
w_d   = weight (table above)

qualityScore = round( Σ_d ( S_d × w_d × C_d ) / Σ_d ( w_d × C_d ) )
overallConfidence = Σ_d ( w_d × C_d )          # coverage-weighted
```

Key properties:

- **Missing dimensions are dropped from both sums** — a mobile-only-swept app is not
  punished as if responsiveness scored 0. `dimensionsMissing` lists them and
  `overallConfidence` falls instead. A quality score with `overallConfidence < 0.5`
  renders with an explicit "low confidence — partial coverage" badge in the UI.
- **Confidence-weighted, not punishment-weighted**: a 40-score dimension measured at
  confidence 0.9 pulls the total down more than a 20-score dimension measured at 0.3.
  The score reflects what we can *prove*, not what we failed to measure.
- **No score inflation**: PASS checks and absent findings cannot raise a dimension
  above 100, and deductions never round up.

## 4. Dimension sources in detail

- **FUNCTIONAL** (3): Phase 16 verified functional defects by severity (same weight
  ladder as UX dimensions: critical 25 … info 0.5) with repetition dampening across
  workflows, plus workflow step failure outcomes. Findings with
  `evidence_sufficient=false` deduct at half weight (suspicion, not proof).
- **UX** (3): weighted roll-up of the UX dimension scores (NAVIGATION, CLARITY,
  RESPONSIVENESS from UX_INTELLIGENCE_MODEL.md), confidence-weighted.
- **ACCESSIBILITY** (1.5): direct from UX ACCESSIBILITY dimension record.
- **FEATURE_COMPLETENESS** (2): validated feature gaps (FEATURE_GAP_MODEL.md) against
  the advertised surface — an app with many advertised-but-dead entries scores low;
  plain unadvertised absences do not deduct.
- **NAVIGATION** (1): direct from UX NAVIGATION dimension record.
- **ERROR_HANDLING** (1): console-error / HTTP-failure density per swept page plus
  feedback-check outcomes.
- **WORKFLOW_RELIABILITY** (2): workflow failure ratio + friction records
  (`uxFriction.js`). Confidence from number of analysed workflow sessions.

## 5. Verdict templates (deterministic)

The one-line verdict is template-generated from the numbers, not LLM-written, e.g.:

- `"Core flows work but mobile experience is broken (RESPONSIVENESS 38/100, conf 0.9)."`
  — triggered when any dimension with confidence ≥0.8 scores <50.
- `"Data integrity concerns (CORRECTNESS 52/100) with N verified functional defects."`
- `"Solid overall; polish issues only."` — all dimensions ≥70 with confidence ≥0.6.

Templates are fixed strings in `qualityAssessment.js` so reports are diffable
run-to-run and greppable in tests.

## 6. What this model deliberately does NOT do

- No LLM in the score path. Every number is reproducible from stored evidence.
- No cross-app comparison tables (premature; only one suite benchmarked so far).
- No trend lines yet — `getUxMetrics()` exposes per-dimension history so Phase 18+
  can add them without schema change.
- Never reports a score when zero dimensions have data (`qualityScore: null` +
  `dimensionsMissing: [all]`) rather than pretending 0 or 100.

## 7. Measured behaviour

See `docs/PHASE_17_REPORT.md` §benchmark: across the 5-app benchmark the model
produced distinct, evidence-linked scores per app (no saturation at 100 or 0),
overallConfidence tracked actual sweep coverage, and the apps with known
responsive-layout defects (MetricsPro mobile sidebar, TaskBoard kanban clipping)
scored lowest on RESPONSIVENESS — matching the Phase 0/7 ground truth.
