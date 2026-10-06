# WhatsApp User Feedback Notifications — permanent fix

## Root cause (verified 2026-10-06, MANOJ @ dcc60b1)

The flow breaks at the first step: **the notifier is never constructed.**

- `QASE_WHATSAPP_ENABLED=false` and `QASE_WHATSAPP_ACCESS_TOKEN` / `QASE_WHATSAPP_PHONE_NUMBER_ID` are EMPTY in the runtime environment (`/drytis-config/environments/b90ad02700c6.env`, the file service-bg-service-4182 sources; identical copy in /workspace/.env).
- `parseWhatsAppConfig` therefore returns `undefined` → `createWhatsAppNotifier` returns `undefined` → the dispatch call in POST /api/feedback is a no-op.
- Evidence: log has ZERO whatsapp lines ever (and the log wiring is confirmed live — app console lines do reach it); the idempotency ledger `.qase/whatsapp-notifications.json` was never created; feedback POSTs succeed with 201 (e.g. 2026-10-06T18:31:44Z). Feedback saving works; notifications are never attempted.
- The silence itself is a defect: when the integration is disabled/misconfigured the system logs NOTHING, so nobody could tell notifications were off.

## Secondary risk (blocks delivery even after enabling)

The module sends free-form `type:'text'` messages. Meta's Cloud API only accepts free-form text inside a 24-hour customer-service window after the recipient last messaged the business number. Outside that window Meta requires a pre-approved **template**. Recipients who have never messaged the business number will get a non-retryable rejection. Fix: optional template mode.

## Provider

Meta WhatsApp Business Cloud API (`POST {origin}/{version}/{PHONE_NUMBER_ID}/messages`, Bearer access token). No unofficial automation.

## Phases

### Phase 1 — Notifier hardening: statuses, per-recipient tracking, diagnostics, retry, template mode
Files: `server/whatsappNotifier.js`, `server/whatsappNotifier.test.js`.
- Ledger entry per feedback id → notification id `WHATSAPP-<feedbackId>` with overall status `PENDING | SENT | FAILED | RETRYING` (keep `partial` → map to FAILED-with-per-recipient detail or keep PARTITION? Use SENT only when ALL recipients accepted; otherwise FAILED with per-recipient states).
- Per-recipient sub-status `{recipient: 'sent'|'failed'|'retrying'}` so retries never resend to recipients already accepted (idempotency remains: notification id = feedback id).
- Retry mechanism: on retryable failure, status RETRYING with bounded attempts; final FAILED entries are replayable via an explicit operator retry (Phase 2) — never auto-loop forever.
- Sanitized diagnostics: every log line carries feedback id, notification id, provider HTTP status, and reason (existing sanitizeErrorDetail pipeline; never tokens).
- Startup visibility: log one line at construction state — enabled, disabled, or invalid+why (sanitized). Never silent again.
- Optional template mode: `QASE_WHATSAPP_TEMPLATE_NAME` (+ `QASE_WHATSAPP_TEMPLATE_LANGUAGE`, default `en`); when set, send `type:'template'` payload with the rating/description/run params as template components; plain text remains default. Document that recipients outside the 24h window REQUIRE a template.

### Phase 2 — Status + retry API (admin-gated)
Files: `server/app.js`, new `server/whatsappNotificationApi.test.js`.
- `GET /api/feedback/notifications` — owner/admin: list notification records (notification id, feedback id, run id, status PENDING/SENT/FAILED/RETRYING, per-recipient states, sanitized lastError, timestamps).
- `POST /api/feedback/notifications/:id/retry` — owner/admin: replays FAILED/partial notifications; per-recipient idempotency guarantees no duplicate sends; returns updated status. Cannot fake success — SENT only on provider 2xx.
- Response contract distinguishes: feedback saved vs provider accepted vs (unavailable) delivery status.

### Phase 3 — Enable, document, E2E verify, publish
- Register missing env keys (template name/language) in backend env store; document all keys in `.env.example` (names + non-secret defaults only).
- **Customer dependency:** customer supplies `QASE_WHATSAPP_ACCESS_TOKEN` + `QASE_WHATSAPP_PHONE_NUMBER_ID` (secret values, never in chat-to-repo); set via env store, enable flag, restart service. Known platform bug (memory: prod-edge-502-continued) can truncate .env on container restart — the env store regenerates it, verify after any restart.
- Real E2E: submit feedback via UI on a completed run → feedback saved → notification PENDING → provider 2xx → SENT → message content contains header/rating/description/run info; failure-mode tests with injected fetch (401/403/429/5xx/timeout), retry-no-duplicate, token-leak greps; regression: feedback endpoints, reports, timer suites.
- Deliverables report: root cause, provider, files changed, env var NAMES, sanitized original error (none existed — silence was the error), flow diagram, test results, E2E confirmation.

## Acceptance criteria (running-app truth)
- [ ] With valid Meta credentials configured, submitting feedback in the UI sends a WhatsApp message to all four recipients (subject to Meta delivery rules).
- [ ] Message contains 📢 header, ⭐ rating, 📝 description, 📊 run info, 👤 submitter, 🕒 timestamp.
- [ ] Feedback stays saved and in the report when the provider fails; UI never claims WhatsApp success falsely.
- [ ] Admin can see per-notification status incl. sanitized failure reason, and can retry a failed notification without duplicate sends.
- [ ] Double-submit/retry produces exactly one message per recipient.
- [ ] No credential appears in logs, ledger, API responses, or git.
- [ ] No regressions: feedback CRUD, report embedding, timer, QA runs all green.
