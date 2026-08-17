# Finding Review Flow — Phase 16

> Human-in-the-loop review over autonomous findings. The reviewer confirms,
> refutes, merges, or requests more information — the LLM never closes the
> loop alone.

## Verdicts (`review_status`)

| Verdict | Effect on lifecycle | Effect on counts |
|---|---|---|
| `confirmed` | → `VERIFYING` (if valid from current state) | Counted as defect |
| `false_positive` | → `FALSE_POSITIVE` | Excluded from grouped defect counts; tracked in `false_positive_rate` |
| `duplicate` | → `DUPLICATE` (requires merge target) | Excluded from canonical counts |
| `needs_info` | stays; flags for follow-up | Counted, marked |

Default is `unreviewed`. Revalidation **never** overwrites a non-unreviewed
verdict.

## Endpoints

```
PATCH /api/findings/:id/review        { reviewStatus, note?, by? }
GET  /api/findings/:id/duplicates     → candidates[] { id, verdict, similarity, signals, title }
POST /api/findings/:id/duplicates     { canonicalId }   — manual merge
POST /api/findings/:id/revalidate     { by? }           — re-run enrichment
```

All mutations require the API token and append audit history.

## Duplicate review policy

1. `GET /:id/duplicates` returns deterministic candidates with verdicts
   `DUPLICATE` / `POSSIBLE_DUPLICATE` / `UNIQUE`.
2. **Possible duplicates are never auto-merged.** The engine stores them as
   `duplicate_candidates` only.
3. A human merges: `POST /:id/duplicates { canonicalId }`.
4. Provenance is preserved on merge — `duplicate_provenance`:
   `{ originalIds, sessions, missions, evidenceCount, mergedAt }`. Nothing is
   deleted; the duplicate remains individually queryable.
5. Canonical = earliest `ts` (deterministic id tie-break). Undo = `PATCH
   /review { reviewStatus: 'confirmed' }` transitions `DUPLICATE → REOPENED`.

## Security during review

- All evidence strings pass through redaction before storage **and** at render
  (passwords, API keys, tokens, cookies, JWTs, PEM blocks — 9 pattern
  families).
- Review actions are audited (`by`, timestamp, note).
- No auth changes: review endpoints sit behind the same `requireApiToken`
  middleware as all mutations.
