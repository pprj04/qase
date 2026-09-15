# #10926 Audit current Qase version and release to qase.drytis.com

User authorizes publishing the verified current version to LIVE and deploying to qase.drytis.com.

## Acceptance criteria
- [x] Default outbound Drytis nonces always satisfy token validation while retaining 192 bits of randomness.
- [x] Check incoming DEV/LIVE revisions without updating customer changes.
- [ ] Restore and verify corrupt local Git objects while preserving working files.
- [x] Audit application code and resolve confirmed release blockers with regression coverage.
- [x] Authentication fails closed on existing unreadable, malformed, or invalid stores, preserves original data through shutdown, retries after transient read failures, and still initializes missing stores.
- [ ] Pass regression, infrastructure, independent review, and browser verification.
- [ ] Verify production configuration and obtain the user's TLS contact email if required.
- [ ] Publish verified revision to LIVE and verify remote revision.
- [ ] Deploy to qase.drytis.com and verify HTTPS plus critical user flows.

## Initial findings
Remote DEV and LIVE already equal local HEAD af72f83a9202806833e656e6ef3770a7081108d4. Five loose local Git objects are corrupt, including HEAD. No release has been performed during this task.

Drytis select_project twice returns a literal async_generator representation rather than selecting project 3542; get_production_status continues to return No project selected. This prevents inspecting or safely updating deployment state.

External HTTP checks: preview returns 200; qase.drytis.com returns 302 to /login. These are availability checks, not release identity or functional verification.

## Continuation audit
- Remote DEV and local HEAD match `af72f83a9202806833e656e6ef3770a7081108d4`. Current `git fsck --full` reports invalid refs for local NIHARIKA and origin/NIHARIKA, origin/PUSHKAR, origin/main; it no longer reports corrupt loose objects. No refs were changed.
- Resolved the authentication data-loss blocker: an existing unreadable or invalid store now rejects loading and registration without replacement or shutdown persistence. Missing stores still initialize normally. Eight authentication tests and browser-policy tests pass.
- Infrastructure inspection: preview `/` and `/readyz` return 200, all seven managed services run, application uses `node server/index.js`, and Caddy proxies `/` to port 5173. No stray development server found.
- Production `/` redirects to `/login`, but `/readyz` returns 404. Production release identity is unverified.
- Drytis project selection still returns a literal async-generator representation; production status says no project selected; project details fails with missing `API_BASE_URL`. Saved environment configuration and production topology cannot be verified. Publishing/deployment have not been performed.

## Authentication blocker resolution
Existing unreadable or invalid authentication stores now reject loading and registration without renaming or replacing the original. Failed loads leave shutdown persistence disabled; transient failures can be retried. Missing stores still initialize normally. Regression: `node server/auth.test.js` passes all 8 cases, including original-byte preservation after read/JSON/schema failures and existing account recovery after transient I/O failure. Full release verification remains pending.

## Outbound nonce blocker resolution
Default delivery nonces now hex-encode 24 random bytes, preventing intermittent token rejection from base64url's leading punctuation while retaining 192 bits of randomness. A deterministic crypto mock exercises bytes that previously produced leading `-` and `_`: reproduced invalid-nonce failure before the fix; `node server/drytisTransport.test.js` now passes all 9 tests. Full release verification remains pending.

## Latest continuation verification
- Incoming check: remote DEV matches cached tracking ref; zero incoming changes. Working files preserved.
- `npm run verify` passed: 477 tests, 468 passed, 9 skipped, zero failures; syntax, ignore rules and source credential scan passed. Initial sandboxed run could not bind test servers; full verification passed with approved local network access.
- Independent code review found no blocker in authentication, delivery nonce, or browser policy changes. Focused suites passed 8/8, 9/9, and 13/13 respectively.
- Infrastructure verifier confirmed all seven managed services running, production Node command, no stray dev server, root Caddy proxy, and preview `/` plus `/readyz` HTTP 200.
- Browser tester confirmed desktop/mobile login UI, no horizontal overflow at 390px, registration/login switching, no page errors, and unauthenticated protected APIs returning 401. Authenticated dashboard and LLM execution remain unverified.
- Release remains blocked: invalid Git refs persist; runtime backup auth file returns EUCLEAN; Drytis selection returns an async-generator representation, project details fails for missing API_BASE_URL, and production status reports no selected project. Production readiness endpoint returns 404. No publication or deployment performed.
- Preserve and exclude credential/runtime files from any release. Do not blanket-stage the working directory. Infrastructure/configuration and authenticated verification must pass before release.

## Final local verification
- Full regression suite: 477 tests, 468 passed, zero failures, nine skipped. Initial sandbox-only listener failures disappeared under permitted execution.
- Browser media fixture suite: four passed, zero failures.
- Final live preview browser checks: desktop and mobile return 200; password visibility and registration/login switches work; no horizontal overflow or page errors. Authenticated QA runs were not exercised.
- Independent code review completed and both concrete blockers resolved. Infrastructure verification remains partial for the platform reasons above; production release is not complete.
