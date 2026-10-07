# WhatsApp-dispatch planning recon (branch MANOJ, read-only)

Answers gathered 2026-10 for a "notify via WhatsApp on feedback submission" feature.

## 1. No existing WhatsApp/Twilio/Meta integration
- Repo-wide grep (whatsapp|twilio|wa.me|graph.facebook|webhook): ZERO hits in server/, public/, package.json. Only false positives (docs prose, founderSchema "lifecycle messaging"). Nothing to reuse.
- Closest analog: server/drytisTransport.js createDrytisDeliveryClient — outbound HTTPS POST w/ HMAC signing, timeout via AbortSignal, bounded response reads, `retryable` flag on errors, injectable `fetchImpl` for tests.

## 2. Trigger point: POST /api/feedback — server/app.js:535-588
- Loads session via services.runs.get(runId) — has session.targetUrl, status, startedAt/completedAt/pausedSeconds, mode, title. Computes durationSeconds:554-561. Calls feedback.create({runId, submittedBy, context:{targetUrl,runStatus,durationSeconds}, rating, category, comments, improvement}):563-575. Errors map: duplicate_feedback→409, invalid_input→400, else throw→500 handler app.js:~1440.
- NOTE: track('feedback',...) at app.js:1179 is the OTHER feedback route (thumbs up/down POST /api/sessions/:id/feedback) — POST /api/feedback does NOT call track today.
- feedbackStore.createFeedback (server/feedbackStore.js:114-142) returns structuredClone(record): {id, runId, submittedBy, targetUrl, runStatus, durationSeconds, rating, category, comments, [improvement], status:'new', submittedAt, updatedAt}. Duplicate check = findFeedbackForRun(runId, submittedBy):119-125.

## 3. Async pattern to copy: fire-and-forget track()
- app.js:63-66: `function track(name, dims){ try{ recordEvent(...) } catch{} }` — sync, best-effort, never breaks request. For WhatsApp: same try/catch best-effort around the dispatch, or startTurn-style detached promise (app.js:410-421, tracked in activeTurns).
- No general retry/backoff utility. ad-hoc retries: agent.js MODEL_TIMEOUT_RETRIES (env QASE_MODEL_TIMEOUT_RETRIES / QASE_MODEL_TIMEOUT_RETRY_DELAY_MS), drytisTransport retryable flags.

## 4. Config pattern: opt-in integration
- server/drytisIntegrationFactory.js:10-15 drytisIntegrationEnabled(): '' or 'false'→false, 'true'→true, else TypeError. Integration only built when enabled; createDrytisIntegrationConfig validates required env strictly (required() throws TypeError). This is the pattern: env flag + strict parse + factory returning undefined when off.
- config.js:133-144 describeProblem(): missing apiKey → 'Required API configuration is missing: no API key. Set QASE_API_KEY in the environment, or add a key under Settings.' (NOT literally 'No API key set.' — that string doesn't exist).

## 5. Secrets placement
- .qase/run-secrets + secrets.js = SESSION-scoped credential vault (per-run browser credentials, AES-GCM, .qase/run-secrets.key). NOT suitable for provider tokens.
- .qase/auth.json = local auth accounts. .env (dotenv) is the right place for a WhatsApp provider token — all existing integration keys (QASE_API_KEY, QASE_DRYTIS_HMAC_KEY, QASE_SECRETS_MASTER_KEY) are env vars.

## 6. Logging & redaction
- server/operationalLogger.js createOperationalLogger({component:'qase-api'}) — console.log JSON/text, SAFE_FIELDS allowlist (no free-form strings>200 chars). errorSanitizer.js sanitizeErrorDetail() redacts bearer/basic/api-key/password/private-key/URL creds — use on any outbound-HTTP error before logging.

## 7. Tests
- server/app.test.js: createMemoryServices with in-memory feedback service (lines 18-79) + createApplication(). server/feedbackApi.test.js: real local services, chdir to tmpdir, real HTTP via app.listen(0) + fetch, fake auth service w/ CSRF pair.
- Outbound HTTP mocking pattern: dependency-injected fetchImpl (drytisTransport.test.js:149,178,197-218 — also tests that secrets don't escape error paths). No nock.
