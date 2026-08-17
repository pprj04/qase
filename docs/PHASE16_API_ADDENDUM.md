# Phase 16 API & Data Model Addendum

> Bug Intelligence 2.0 — new endpoints, fields, and filters. **All additive and
> backward compatible.** See `BUG_INTELLIGENCE_MODEL.md` for semantics.

## New endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| PATCH | `/api/findings/:id/classification` | token | `{ primaryCategory, secondaryCategories?, confidence? }` — validated enum, max 3 secondary, audited |
| PATCH | `/api/findings/:id/severity` | token | `{ severity, confidence?, rationale? }` — enum + explainability, audited |
| PATCH | `/api/findings/:id/priority` | token | `{ priority, rationale? }` — P0–P3, audited |
| PATCH | `/api/findings/:id/review` | token | `{ reviewStatus, note?, by? }` — verdicts, lifecycle-coupled |
| PATCH | `/api/findings/:id/lifecycle` | token | `{ findingStatus, detail? }` — validated transition table |
| POST | `/api/findings/:id/revalidate` | token | Re-run deterministic enrichment; increments reproducibility attempts |
| GET | `/api/findings/:id/duplicates` | — | Candidates `{ id, verdict, similarity, signals, title }` |
| POST | `/api/findings/:id/duplicates` | token | Manual merge `{ canonicalId }` — provenance preserved |
| GET | `/api/findings/:id/related` | — | Same workflow/feature/page/category relations |
| GET | `/api/findings/:id/affected-workflow` | — | Resolved workflow linkage (or UNKNOWN) |
| GET | `/api/findings/:id/affected-feature` | — | Feature/component/API-endpoint linkage |
| GET | `/api/findings/:id/evidence` | — | Typed evidence items (redacted) |
| GET | `/api/findings/grouped?groupBy=` | — | `category\|severity\|priority\|workflow\|feature\|risk`; duplicates & FPs excluded from canonical counts |
| GET | `/api/findings/duplicates` | — | Canonical duplicate-group overview |
| GET | `/api/bug-intelligence/metrics` | — | Counters + latency histograms |
| GET | `/api/bug-intelligence/enums` | — | Taxonomy (categories, priorities, lifecycle, review verdicts) |

Errors: 400 with `{ error }` for invalid enums/transitions; 404 when missing;
401 for unauthenticated mutations (unchanged middleware).

## Extended endpoints

- `GET /api/findings` — new optional filters: `primaryCategory` (alias
  `primary_category`), `priority`, `findingStatus`, `reviewStatus`,
  `workflowId`, `featureId`, `missionId`, `reproducibility`, `minConfidence`,
  `includeDuplicates` (default true). Old filters unchanged.
- `POST /api/findings` — accepts all new fields; absent fields default.
- Responses now include the intelligence fields below (additive).

## New finding fields (all optional, defaulted on read)

**Lifecycle:** `finding_status` (DETECTED), `review_status` (unreviewed),
`reproduction_attempts` (0), `successful_reproductions` (0),
`reproduction_rate` (null)

**Classification:** `primary_category` (UNKNOWN), `secondary_categories` ([]),
`classification_confidence`, `classification` `{ method }`

**Severity/priority:** `severity_confidence`, `severity_rationale`,
`severity_signals[]`, `priority`, `priority_rationale`

**Confidence:** `confidence`, `confidence_reason` `{ level, signals[],
contributions[] }`

**Evidence:** `evidence_refs[]` (typed evidence ids, cap 50),
`evidence_sufficiency` `{ sufficient, reasons[], present, required }`

**Expected/actual:** `expected_source`, `expected_uncertain`

**Linkage:** `workflow_id`, `feature_id`, `page`, `component`,
`api_endpoint`, `linkage_confidence`, `linkage_basis`

**Duplicates:** `duplicate_candidates[]`, `duplicate_provenance`

**Root cause:** `root_cause_category`, `root_cause_confidence`,
`potential_causes[]`

**Output:** `risk`, `risk_rationale`, `quality` (5 dimensions + overall),
`dev_summary`, `enriched_at`, `intelligence_version`

## Storage / migration

Persistence remains JSON-file based (`.qase/findings.json`) — the project's
established store (MySQL is provisioned but unused by QASE). **No destructive
migration**: on load, `ensureIntelligenceFields` applies defaults lazily;
a one-time guarded backfill (`backfillIntelligenceFields`) derives
`primary_category`/`finding_status`/`review_status` for historical rows and
writes a marker (`.finding-intelligence-backfill`). Old findings stay fully
readable; they simply gain defaults.

## Observability

`GET /api/bug-intelligence/metrics`:

```json
{
  "findings_detected": 0, "findings_enriched": 0, "findings_verified": 0,
  "findings_false_positive": 0, "findings_duplicate": 0,
  "enrichment_runs": 0, "enrichment_failures": 0,
  "verification_rate": 0, "false_positive_rate": 0, "duplicate_rate": 0,
  "classification_latency_ms": {"avg": 0, "max": 0},
  "duplicate_detection_latency_ms": {"avg": 0, "max": 0},
  "enrichment_latency_ms": {"avg": 0, "max": 0}
}
```
