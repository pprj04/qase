# Verify security and data isolation — #12958 (Phase 6)

Audit complete (researcher report). This phase implements the prioritized fixes and closes the test gaps. The security-testing FEATURE is Phase 7; multi-browser Phase 8.

## 12958a — [HIGH] Env-gateway-key exfiltration chain

Anyone can register (open route) then point `/api/config/test` (or saved config) at an attacker host; the effective apiKey falls back to the process-env gateway key and is sent as a Bearer header to that host.

Fixes:
1. Registration gating: closed when `NODE_ENV=production` unless `QASE_OPEN_REGISTRATION=true`; allowed otherwise (dev/pilot). Error: 403 with clear message.
2. Key-destination guard in config.js: when the effective API key comes from the ENV layer (user supplied none), `testConnection`/saved runtime use may only target the env-configured base URL host (or an explicit `QASE_ALLOWED_MODEL_HOSTS` allowlist). User-supplied keys may go anywhere. Same guard applied where agent.js resolves provider runtime.

Tests: config.test.js — env-key + foreign host probe refused (unit on testConnection); app-level 403 on register in prod mode; register allowed in dev.

## 12958b — [MED] Account-throttle key collapses to global owner

`instanceAccess` pre-populates `request.auth` with the fixed owner UUID, so the per-account throttle key is constant → 10 failed logins lock the whole instance for 15 min.

Fix: throttle key uses the normalized request-body email (lowercased, trimmed) for unauthenticated auth routes, falling back to IP when absent.

Tests: app-level — 10 failures for user A do not throttle user B.

## 12958c — [MED] Demo site reflected XSS (same-origin with dashboard)

`/demo/app/search` interpolates raw `q` into HTML.

Fix: HTML-escape the query before interpolation (escapeHtml helper in demoSite.js).

Tests: app.test.js — `?q=<script>` renders escaped text, no raw `<script>` in body.

## 12958d — [MED] Postgres store loses runStartedAt/feedback

runRepository.save never writes started_at/completed_at; no feedback column; hydration drops both.

Fix: migration `00X_run_feedback.sql` adds `feedback JSONB` to qa_runs; save writes started_at/completed_at/feedback; hydration restores them.

Tests: postgres suite (skipped without QASE_TEST_DATABASE_URL — code verified by review; local store already covered).

## 12958e — Test gaps to close

- CSRF middleware test: POST without X-CSRF-Token → 403; with mismatched token → 403; with matching token → passes.
- Config/test SSRF guard test (part of 12958a).
- Registration gating tests (part of 12958a).
- Cookie flags on HTTPS/production login response.
- SSE cross-user isolation: user B cannot GET user A's session events (404).

## Deferred (documented, not this phase)

- Encrypt `.qase/config.json` API key via accountSettings AES-GCM (needs per-user key model decision — Phase 10 ops).
- Session TTL/idle hardening, scrypt N=2¹⁷ (policy; Phase 10).
- Postgres Drytis nonce store in prod (deploy config; Phase 10).
- Pin `@cleanslate/sdk` exact version (Phase 10 packaging).
- DNS-rebinding TOCTOU residual risk (documented in infrastructure.md).
- Rotate the live gateway key (operator action — flagged to user at phase close).

## Acceptance criteria
- [ ] Registration returns 403 in production mode unless explicitly enabled
- [ ] /api/config/test with env-fallback key + non-allowlisted host is refused; user-supplied key still works
- [ ] Throttle is per-email, not global; failed logins for one account don't lock others
- [ ] Demo search escapes HTML; `<script>` payload renders as text
- [ ] Postgres save/hydrate covers runStartedAt + feedback (migration present)
- [ ] CSRF, cookie-flag, and cross-user SSE tests exist and pass
- [ ] Full `npm run verify` green; reviewer + tester PASS
