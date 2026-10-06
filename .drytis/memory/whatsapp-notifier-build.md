# WhatsApp feedback notifications — build notes (tickets #15016/#15018/#15021, commits 9e64cf2, a645fd8, dcc60b1 on MANOJ)

## What was built
- server/whatsappNotifier.js: Meta WhatsApp Business Cloud API dispatch. Strict env parse — QASE_WHATSAPP_ENABLED (true/false opt-in, default false), QASE_WHATSAPP_ACCESS_TOKEN (secret), QASE_WHATSAPP_PHONE_NUMBER_ID (secret), QASE_WHATSAPP_RECIPIENTS (comma E.164; real 4 recipients live ONLY in the backend env-key default, never in source), QASE_WHATSAPP_API_VERSION (default v20.0), QASE_WHATSAPP_API_ORIGIN (default graph.facebook.com, overridable for tests).
- Idempotency ledger: .qase/whatsapp-notifications.json keyed by feedback id, atomic tmp+rename, mode 0600. 'pending'/'delivered' entries never resend; crash mid-dispatch leaves 'pending' → deliberately never auto-replayed.
- Retry: max 3 attempts, 2s×attempt backoff; 429/5xx/timeout retryable; 401/403 ABORTS the whole dispatch (1 call, no further recipients). Partial delivery recorded as 'partial'.
- server/app.js: notifier built once in createApplication (inject via options.whatsappNotifier; undefined = off → identical legacy behavior). POST /api/feedback dispatches AFTER feedback.create() persists, detached (not awaited), context {mode, title, targetUrl, submittedAt: record.submittedAt ?? Date.now()}.
- Env keys registered via bulk tool: ids 52686–52690 in /workspace/.env.

## Verification status
- 22/22 unit + 6/6 integration + full server suite green (1 pre-existing targetReachability split-horizon fail).
- infra_verifier PASS; reviewer PASS; tester PASS 5/5 (no UI change, no +91 leak in DOM, report section intact).

## Open WARNs / follow-ups (recorded on #15021 as recommendations, NOT implemented)
1. Detached dispatch not registered in activeTurns/whenIdle — graceful shutdown may drop an in-flight notification (ledger stays pending; no resend).
2. No operator retry/replay endpoint for 'failed' ledger entries — could be added since the ledger tracks them.
3. Message timestamp is UTC (deterministic); reports use server-local toLocaleString.

## Gotchas learned
- Container ICU renders en-GB hour12 as "05:00:00 pm" — formatSubmittedOn builds the 06-Oct-2026 5:00 PM string from UTC parts manually for portability.
- Real recipient numbers were initially in test fixtures; swapped to synthetic +1555… after infra_verifier WARN. Never put the +91 numbers in source again.
- feedbackApi tests: createFakeAuthService pattern with cookie qase_session + x-csrf-token headers; TENANT needs organizationId/projectId/actorUserId UUIDs. Duplicate check (409) fires BEFORE validation (400) in POST /api/feedback.
- services.runs.create signature: create(targetOrTitle, {ownerUserId, eventType}) — see feedbackApi.test.js finishedRun helper.
