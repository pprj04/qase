# D1 close-out acceptance pass — findings (2026-08-31)

## D1.9 defect found & fixed (final pass)
`renderTestCaseCard` derived Mission/Session chips from `provenanceCache.workflows` — but the `/api/workflows` LIST projection omits `sessionId` (0/630 rows carry it), so chips NEVER rendered; cards showed only "Source: Workflow <id>" even when the test case record itself carries `sessionId`+`missionId`. FIXED in public/tests.js: card now prefers `tc.sessionId`/`tc.missionId`/`tc.workflowId` directly (authoritative, immune to Phase 9.3 session-shell pruning); workflow-cache chain kept as fallback for older records. Verified live in browser: 19 cards show `Mission … Session … Workflow …`, 5 older cards show `Workflow …` only. Served file needed a hard reload to bust module cache.

## Pre-existing findings (NOT D1, not fixed — reported)
1. **Artifact thumbnails 401 in `<img>` tags**: `/api/artifacts/*` correctly requires auth; `<img src>` cannot send the Bearer header and the `qase_token` cookie is not set in normal operator flow (localStorage token only, cookie never auto-granted since M1-P3). History panel shows ✗/✓ results + timestamps correctly, but screenshot thumbs render broken in a cookie-less browser. Artifacts ARE accessible (200 via Bearer fetch). Fix would be fetch→blob or signed URLs — not D1-scoped, deferred.
2. **Pruned session deep-link UX**: `#/runs/85ce0ffd…` → "No such session" 404 (Phase 9.3 shell pruning, documented). Mission record + evidence remain intact via API.
3. `/api/auth/session` 401 console noise on boot (expected probe when token-auth active, not an error condition worth hiding).

## Acceptance re-verification
- Integrity: mission→workflow(38 steps, sessionId-linked)→3 TCs→replays (2/3/3 runs, fail/pass/fail truthful)→38 evidence rows all sessionId+iterationId→16 findings all sessionId. RUNA/RUNB/D1.6: 0 D1 orphans. Session SHELL for golden pruned again (13 sessions listed) — expected.
- Refresh/reopen: missions/sessions/workflows/testCases/replay counts stable across navigation (the +3 missions at 01:55:17 were b1-security-negative suite fixtures, not duplicates from refresh). Golden mission appears exactly once.
- Secrets: swept server logs (current + rotated), all changed+untracked test files, golden evidence metadata, replay runs, /api/config response, page DOM — zero hits for QASE_API_TOKEN / LLM key / QASE_SECRET_KEY / integration secret.
- Regression minimal set: d1 15/15 (with LIVE ids) + 4 pass/0 fail (offline), c4 24/24, ui-access 20/20, api-contract 31/31, b1-security-negative 17/17.
