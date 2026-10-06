# WhatsApp notifications FIX — root cause + final state (tickets #15068/#15069/#15071, origin/MANOJ bf053c2)

## Root cause (verified, not assumed)
Integration was DISABLED: QASE_WHATSAPP_ENABLED=false and empty QASE_WHATSAPP_ACCESS_TOKEN/QASE_WHATSAPP_PHONE_NUMBER_ID in the runtime env (/drytis-config/environments/*.env sourced by service-4182.sh; /workspace/.env identical). parseWhatsAppConfig → undefined → notifier never built → dispatch no-op. Evidence: zero whatsapp log lines ever; .qase/whatsapp-notifications.json never created; feedback POSTs 201. Secondary defect: silent disabled state — fixed with startup log whatsapp.integration {state: enabled|disabled|invalid}.

## What was built (commits 31d3f41, 5a89874, 394d66f, 4527a49, bf053c2)
- Statuses PENDING/RETRYING/SENT/FAILED, notification id WHATSAPP-<feedbackId>, per-recipient {state, attempts(cumulative), upstreamStatus, lastError}; SENT only when ALL recipients 2xx.
- Per-recipient isolation; 401/403 terminal abort; retryable 429/5xx/timeout, max 3 attempts PER DISPATCH (local counter — recipient.attempts is cumulative; bug found: using cumulative attempts blocked retries after exhaustion).
- retryNotification guards: not_found/already_sent/in_progress/not_replayable; sent recipients skipped on replay. Ledger stores replay context (feedback rating/comments + context) — no secrets.
- Template mode: QASE_WHATSAPP_TEMPLATE_NAME/_LANGUAGE → type='template' with 6 body components (required outside Meta's 24h customer-service window — free-form text only works within it).
- API: GET /api/feedback/notifications (admin, filters status/feedbackId, enabled:false shape when off), POST /api/feedback/notifications/:id/retry (404/409/501). Both note SENT = provider acceptance, not device delivery.
- operationalLogger SAFE_FIELDS + state/recipients/notificationId/feedbackId.

## Verification
643 tests/624 pass (only pre-existing split-horizon DNS fail); infra_verifier PASS; reviewer PASS 9/9; tester PASS 5/5. Published origin/MANOJ. NOT yet on DEV (boot branch is DEV — merge needed before container replacement).

## STILL BLOCKING real delivery
Customer must supply QASE_WHATSAPP_ACCESS_TOKEN + QASE_WHATSAPP_PHONE_NUMBER_ID (Meta WhatsApp Business account), then set QASE_WHATSAPP_ENABLED=true (env store: ids 52686-52695). Also: recipients who haven't messaged the business number in 24h need an approved template → set QASE_WHATSAPP_TEMPLATE_NAME. Platform bug (prod-edge-502-continued memory): .env can truncate after container restarts — update_production_config restores it; the startup whatsapp.integration line now makes misconfig visible in logs immediately.

## Reviewer WARNs (recorded on #15071 as recommendations)
Sanitized provider detail computed but not surfaced in lastError; requireFeedbackAdmin passes falsy role (pre-existing shared pattern).
