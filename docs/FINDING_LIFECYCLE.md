# Finding Lifecycle — Phase 16

> How a raw agent observation becomes trustworthy, structured engineering
> intelligence. Companion to `BUG_INTELLIGENCE_MODEL.md`.

## Pipeline

```
raw finding (agent report_finding tool / API POST /api/findings)
        │
        ▼
[1] DETECTED ── recorded, secrets redacted, defaults applied
        │  (async post-processing after mission finalize — never blocks)
        ▼
[2] enrichment (deterministic engine, INTELLIGENCE_VERSION phase16-v1)
        │  classification · severity · priority · confidence
        │  reproducibility · evidence sufficiency · linkage
        │  duplicates · root cause · quality · risk · dev summary
        ▼
[3] lifecycle derivation (evidence gate)
        │  sufficient evidence → VERIFIED (via VERIFYING)
        │  attempts ≥1, 0 successes → UNREPRODUCIBLE
        │  no evidence at all → INCONCLUSIVE
        │  else stays DETECTED / VERIFYING
        ▼
[4] human review (PATCH /api/findings/:id/review)
        │  confirmed | false_positive | duplicate | needs_info
        ▼
[5] triage (PATCH /classification, /severity, /priority)
        ▼
[6] REPORTED (report generation; duplicates & FPs excluded from counts)
```

## States

`DETECTED → VERIFYING → VERIFIED → CLASSIFIED → TRIAGED → REPORTED`
with terminal/side outcomes: `FALSE_POSITIVE`, `DUPLICATE`, `INCONCLUSIVE`,
`UNREPRODUCIBLE`, and `REOPENED` for returns.

The full transition table lives in `BUG_INTELLIGENCE_MODEL.md` §1 and in code
(`LIFECYCLE_TRANSITIONS`, `server/findingIntelligence.js`). Highlights:

- `DETECTED → VERIFIED` **does not exist** — the evidence gate forces the
  `VERIFYING` hop. `deriveLifecycle` only derives `VERIFIED` when
  `evidence_sufficiency.sufficient === true`.
- `FALSE_POSITIVE` / `DUPLICATE` are reachable from most states (a human can
  refute a finding at any point) and only leave via `REOPENED`.
- `RESOLVED → REPORTED` exists so a fixed finding can still be included in a
  final report.

## Outcomes vs. states

| Outcome | Stored as | Semantics |
|---|---|---|
| False positive | `review_status='false_positive'` + `finding_status='FALSE_POSITIVE'` | Not a real bug; excluded from grouped counts |
| Duplicate | `isDuplicate=true`, `duplicateOf=<canonical>` + `finding_status='DUPLICATE'` | Same root issue as canonical; excluded from grouped counts, provenance preserved |
| Inconclusive | `finding_status='INCONCLUSIVE'` | Not enough information to judge |
| Unreproducible | `finding_status='UNREPRODUCIBLE'` + attempts/successes | Attempted at least once, never reproduced |
| Resolved | legacy `status='resolved'` (kept) | Fixed |
| Reopened | `finding_status='REOPENED'` | Regression or wrongful closure |

## Revalidation

`POST /api/findings/:id/revalidate` re-runs deterministic enrichment:

1. `reproduction_attempts += 1`
2. evidence re-collected from the evidence graph (redacted)
3. classification/severity/priority/confidence recomputed
4. `successful_reproductions += 1` iff the re-run derives VERIFIED
5. history audit entry `revalidated { verified: true|false }`

A human review verdict other than `unreviewed` is **never overwritten** by
revalidation.

## Audit trail

Every mutation appends to `history[]`: field, from, to, by, ts, detail.
Classification, severity, priority, review, lifecycle, duplicate merges, and
revalidations are all audited.
