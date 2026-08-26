# C1 — Dev Team Usage/Traffic API Integration

Parent: B2 @ 9023a42. Discipline: discover → map → implement ONLY verified gaps → test → document.

## Phase 0 findings (verified live 2026-08-26)

The `/api/v2/*` Bearer read surface ALREADY EXISTS (built earlier this session, untracked):
30 GET endpoints, `{data,total,page,page_size}` envelope (default 100 / max 500), ISO-8601 UTC,
`from`/`to` filters (from inclusive, to exclusive, invalid → 400), `X-Correlation-Id` echoed,
`GET /openapi.json` (OpenAPI 3.1, 30 GET operations, operationIds, response schemas), 29 passing tests.

Ground truth: 2 projects, 3,479 missions, 5,469 findings, 24 sessions, 500 fix-validations,
200 regression runs. Store counts == API totals (verified). Perf: 500-row pages ~14–22 ms.

## Verified gaps (only these get built)

G1 CONTRACT BUG — `/api/v2/health` is declared `public: true` in /openapi.json but the
router auth-gates it (anonymous → 401). The test claiming to verify publicity sends the
Bearer header (false positive). Fix: exempt /health (matches legacy /api/health precedent),
and fix the test to actually go anonymous.

G2 NO TIME-BUCKETED USAGE AGGREGATE — "usage/activity over time" requires the agent to page
ALL records in a window (7 days = 1,625 missions = 4 pages) and bucket client-side. Add ONE
aggregation endpoint `GET /api/v2/usage/summary` strictly derived from existing stores.

G3 NO API-TRAFFIC TELEMETRY — no store contains request data; "traffic" on QASE's own API
cannot exist without counting. Add minimal bounded request counter middleware on /api/v2/*
+ `GET /api/v2/metrics/api-usage`. Honest limits: counts since deployment only, no backfill.

G4 DOC GAP — no Dev Team playbook; reference client consumes v1 HMAC surface only.

## Explicitly NOT built (unresolved / impossible without product decisions)

- "User statistics" — QASE is single-tenant (one Bearer token); no user/actor fields exist
  in any record. Marked UNRESOLVED in the mapping; no fabrication.
- Target-application traffic — QASE does not observe target-app users. UNRESOLVED.
- Scoped read-only credentials — token is read-write (pre-existing follow-up, documented).
- No new write endpoints. No changes to B0/B1/B2 behavior (one exception: the health
  public exemption, which RESTORES the documented contract).

## Acceptance criteria

- [ ] Anonymous GET /api/v2/health → 200; /openapi.json still declares it public; test no longer false-positive
- [ ] GET /api/v2/usage/summary returns window+totals+buckets matching store ground truth for a known window
- [ ] GET /api/v2/usage/summary: malformed from/to → 400; unknown bucket → 400; empty window → zeros not errors
- [ ] Request counter: N authenticated calls to /api/v2/missions → counter records N; anonymous 401s counted separately (or not counted — decided in impl, documented); persisted to .qase/api-usage.json; survives restart; bounded (≤90 days, ≤200 patterns/day)
- [ ] GET /api/v2/metrics/api-usage returns {data,total,page,page_size} + `since` marker
- [ ] Both new endpoints appear in /openapi.json with schemas; document validates (npm run test:openapi)
- [ ] Security negatives for v2: anonymous → 401, invalid token → 401 on EVERY collection endpoint (sampled), malformed date → 400
- [ ] v2 pagination clamp: page_size=99999 → 500
- [ ] External client (examples/dev-agent/) authenticates, queries summary + missions + api-usage, parses, handles a bad token correctly — no QASE UI
- [ ] docs/dev-team-playbook.md written with auth, correlation, usage patterns, limitations/unresolved sections
- [ ] Existing suites stay green: pulse-openapi-api (13), pulse-openapi-document (16), b1 canaries, b0
- [ ] No secrets, filesystem paths, or chain-of-thought in any response
