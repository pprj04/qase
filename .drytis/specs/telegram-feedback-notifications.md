# Replace WhatsApp User Feedback notifications with Telegram

## Previous WhatsApp flow (architecture, for the removal report)
- `server/whatsappNotifier.js` — Meta Cloud API dispatch module (strict env parse, message builder, per-recipient retry, file-backed idempotency ledger `.qase/whatsapp-notifications.json`, status tracking PENDING/RETRYING/SENT/FAILED, `WHATSAPP-<feedbackId>` notification ids, webhook delivery-status ingestion).
- `server/app.js` — notifier construction (`createConfiguredWhatsAppNotifier`), POST `/api/feedback` save-then-dispatch with bounded await (`QASE_WHATSAPP_RESULT_TIMEOUT_MS`) → response `{feedbackSaved, whatsappSent, whatsapp:{status,recipients}}`; GET+POST `/webhooks/whatsapp`; admin GET `/api/feedback/notifications` + POST `/api/feedback/notifications/:id/retry`; error-middleware 200 special-case for the webhook path.
- `public/app.js` — truthful post-submit status line (`state.feedback.notified`) + modal close guard.
- Env keys ids 52686–52690, 52694–52697 (all QASE_WHATSAPP_*); `.env.example` section; `scripts/test-whatsapp.mjs`; `server/operationalLogger.js` SAFE_FIELDS whatsapp entries.
- Tests: `whatsappNotifier.test.js`, `whatsappNotificationApi.test.js`, `whatsappWebhook.test.js`, `feedbackNotifyApi.test.js`.
- **Shared-infrastructure check (verified by repo-wide grep): the ONLY consumers of all of the above are the User Feedback workflow. Nothing else in QASE uses WhatsApp. Full removal is safe.**

## Target: Telegram Bot API
Official Telegram Bot API `POST https://api.telegram.org/bot<TOKEN>/sendMessage` with JSON body `{chat_id, text, disable_web_page_preview:true}`. Response `{ok:true, result:{message_id, date, chat}}` or `{ok:false, error_code, description}`. The token lives in the URL path → **the full URL is NEVER logged** (log endpoint as `bot<redacted>/sendMessage` only); sanitize any upstream error detail.

Error mapping: 401 → telegram_auth_failed (invalid/expired token, NOT retryable); 400 → telegram_rejected (bad/invalid chat id, payload); 429 → telegram_rate_limited (retryable, honor retry_after when present); 5xx → telegram_server_error (retryable); timeout/network → telegram_timeout / telegram_unreachable (retryable).

### Env (names only)
| key | secret | notes |
|---|---|---|
| `QASE_TELEGRAM_ENABLED` | no | strict true/false, unset → off |
| `QASE_TELEGRAM_BOT_TOKEN` | **yes** | from @BotFather |
| `QASE_TELEGRAM_CHAT_IDS` | no | comma-separated chat ids; empty default (customer supplies) |
| `QASE_TELEGRAM_RESULT_TIMEOUT_MS` | no | default 10000 (same bounded-await pattern) |
| `QASE_TELEGRAM_API_ORIGIN` | no | default https://api.telegram.org, overridable for tests |

Remove env keys 52686–52690, 52694–52697 (QASE_WHATSAPP_*) via remove_environment_key after code removal; strip the `.env.example` section.

### Message format (exact, from the request)
```
📢 QASE User Feedback Received

A new user feedback has been submitted after completion of a QASE testing task.

⭐ Rating: <n>/5

📝 User Feedback:
<description — '(no description provided)' when empty>

📊 QA Run: <mode label: New QA Run | SQA | Founder Review> #<first 8 of runId>
👤 Submitted By: <name or 'QASE user'>
🕒 Submitted On: <07-Oct-2026 10:30 PM — manual UTC-parts formatter, reuse formatSubmittedOn pattern>
```
4096-char cap (Telegram limit). No parse_mode (plain text — no injection surface, no markdown escaping needed).

### Module design — `server/telegramNotifier.js`
Mirror the proven whatsappNotifier architecture wholesale (same DI: environment/logger/fetchImpl/createTimeoutSignal/sleep/ledger; same atomic 0600 ledger `.qase/telegram-notifications.json`):
- Status model **PENDING → SENDING → SENT**, on failure **FAILED** with retryNotification (RETRY on replay); per-recipient {chatId, state, attempts, messageId, lastError}; notification id `TELEGRAM-<feedbackId>`; idempotency: prior SENT/SENDING never resend; sent recipients skipped on retry.
- Capture `result.message_id` per chat (publicEntry projection).
- Per-attempt sanitized logs `telegram.delivery.attempt` {notificationId, feedbackId, chatId, attempt, provider 'telegram-bot-api', endpoint 'bot<redacted>/sendMessage', status, messageId, errorCode, reason} — never the token or full URL.
- Startup visibility `telegram.integration {state: enabled|disabled|invalid, chatIds count}` — no token value.
- No webhook needed: sendMessage response is synchronous acceptance; message_id capture is the delivery proof (no HTTP-200-means-delivered ambiguity as with WhatsApp).

### app.js rewiring (Phase 2)
- Delete: `createConfiguredWhatsAppNotifier` import + construction, `/webhooks/whatsapp` GET+POST routes, error-middleware `/webhooks/whatsapp` special case, all whatsapp* identifiers.
- POST `/api/feedback`: same bounded-await dispatch via telegramNotifier → response `{...record, feedbackSaved, telegramSent, telegram:{status, message?, recipients:[{chatId, state, messageId?}]}}`. Telegram failure never fails the request (201, feedback saved).
- Admin endpoints re-pointed: GET `/api/feedback/notifications` (telegram ledger, filters), POST `/api/feedback/notifications/:id/retry` — same guard semantics (not_found 404, already_sent/in_progress/not_replayable 409, disabled 501).
- operationalLogger SAFE_FIELDS: swap whatsapp fields for telegram equivalents (keep the shared safe names).
- Delete files: `server/whatsappNotifier.js`, `server/whatsappNotifier.test.js`, `server/whatsappNotificationApi.test.js`, `server/whatsappWebhook.test.js`, `scripts/test-whatsapp.mjs`. New: `server/telegramNotifier.test.js`, `server/feedbackNotifyApi.test.js` rewritten for telegram contract, `scripts/test-telegram.mjs` (env names only, truthful non-zero exit while disabled).

### Frontend (Phase 3)
`public/app.js` submitFeedback: status line now keyed on `record.telegramSent` / `record.telegram.status` — 'Telegram notification sent ✓' / pending / failed-but-saved; plain success when integration absent/disabled. Keep close/Esc guard, keep no-notification-data-in-localStorage. Grep gate: no `api.telegram.org`, no bot-token-shaped strings in public/.

### Customer dependency
Real delivery requires the customer to create a bot (@BotFather) and provide `QASE_TELEGRAM_BOT_TOKEN` + `QASE_TELEGRAM_CHAT_IDS` (each chat must have started the bot / or use group chats with the bot added). Until then: integration reports disabled truthfully (same pattern as WhatsApp fix #15068).

## Phases
1. **telegramNotifier module + unit tests** (config, message, dispatch multi-chat, idempotency, retry, error taxonomy, token-leak regression).
2. **app.js rewiring + WhatsApp removal + env swap + admin endpoints + CLI script + API tests.**
3. **Frontend status wording + security gate.**
4. **E2E matrix (22 checks from the request), suites, infra gate, publish to origin/MANOJ, deliverables report.**

## Acceptance criteria (running-app truth)
- [ ] Submitting feedback (QA or SQA) saves it, shows it in the report and downloaded report (md+PDF) — unchanged.
- [ ] With QASE_TELEGRAM_* configured, each configured chat receives the message with header, rating, description, QA Run line, submitter, timestamp.
- [ ] WhatsApp is not triggered by User Feedback in any way: no QASE_WHATSAPP_* env keys remain, whatsapp module/routes/tests deleted, grep clean.
- [ ] telegramSent:true only when the Telegram API accepted the message for every chat; failures reported truthfully, feedback stays saved and in reports.
- [ ] Duplicate submits / page refresh / backend retry never produce duplicate messages (TELEGRAM-<feedbackId> idempotency).
- [ ] Bot token never appears in frontend, Git, logs, API responses, or URLs shown to users.
- [ ] No regressions: full server + public suites pass (known pre-existing split-horizon DNS failure excluded).
