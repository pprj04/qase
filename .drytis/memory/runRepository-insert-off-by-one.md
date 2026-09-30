# runRepository.js INSERT off-by-one — RESOLVED (final)

## History
- Found in merge-reconciliation review of f01e01c (2026-09-30): insertAggregate had 31 columns / 30 VALUES exprs / 29 params — `security_authorization` had no placeholder. Pre-existing (introduced at merge 3f0d437), carried through both parents.
- Fixed in `ae382b2`: `$29` added for security_authorization; structural guard added in runRepository.test.js ("token usage round-trips" test): distinct placeholders === params.length, max placeholder === params.length, exactly 2 literal expressions. Guard proven effective.
- Side effect of ae382b2: a global sed also rewrote `save()` UPDATE `report_ended_at = COALESCE(report_ended_at, $28)` → `COALESCE(report_ended_at, $28,$29)` (undocumented; would absorb cancelledAt into report_ended_at). Flagged as WARN in re-review.
- Reverted in `ef8e925` (verified 2026-09-30 final review): line restored to `COALESCE(report_ended_at, $28)`; net diff of ae382b2+ef8e925 vs f01e01c in runRepository.js is exactly one line — the `$29` appended to the INSERT VALUES.

## Verified at ef8e925 (HEAD of DEV)
- INSERT (instrumented fake pool, real code path): 31 columns = 29 distinct placeholders (max $29) + NULL + 0 = 31 expressions; params length 29. Balanced.
- UPDATE `save()`: `report_ended_at = COALESCE(report_ended_at, $28)`, `cancelled_at = COALESCE(cancelled_at, $29)` — original form.
- Guard test intact at runRepository.test.js ~678–705.
- Suite: 758 tests / 738 pass / 0 fail / 20 skipped. healthz 200 local; preview 200.

## Remaining known gaps (unchanged, informational)
- No populated-`security_authorization` round-trip test (trailing-param assertions check nulls only) — the INSERT is structurally guarded now, but hydration of a populated securityAuthorization is untested.
- No structural guard on the `save()` UPDATE (guard covers INSERT only).
- DEV is ahead of origin/DEV by 4 unpushed commits (affd691, f01e01c, ae382b2, ef8e925) as of this review.
