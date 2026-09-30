Update to runRepository-insert-off-by-one.md finding — fixed in commit ae382b2 on DEV.

FIXED (verified 2026-09-30 re-review):
- insertAggregate now 31 columns / 31 VALUES expressions / 29 distinct placeholders, max $29; $29 binds security_authorization (json). Balanced.
- Structural guard added in runRepository.test.js 'token usage round-trips' test: distinct placeholders === params.length, max placeholder === params.length, exactly 2 literal expressions (NULL, 0). Correctly fails if off-by-one recurs.
- Shadowed `const securityAuthorization` removed from public/app.js submit handler (single declaration at line 4182).
- Suite 758/738/0 fail/20 skipped; healthz 200 local, preview 200.

NEW WARN (ae382b2, undocumented): the same commit also changed save()'s UPDATE:
`report_ended_at = COALESCE(report_ended_at, $28)` → `COALESCE(report_ended_at, $28,$29)`
($28 = reportEndedAt, $29 = cancelledAt). Not mentioned in the commit message. Plausibly an
accidental leftover from hand-editing placeholders. Semantics: cancelledAt now written into
report_ended_at when reportEndedAt is null. Params stay bound (no SQL break) and no test covers
this. Recommend reverting unless intentional.

Still-open prior gap: no populated-security_authorization round-trip test in runRepository.test.js
(trailing param assertions check nulls only).
