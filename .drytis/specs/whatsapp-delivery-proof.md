# QASE Feedback → WhatsApp: full delivery proof (v3)

Context: the flow was hardened in #15068–#15071 (statuses PENDING/RETRYING/SENT/FAILED, per-recipient isolation, admin status/retry API, startup visibility). The verified root cause of "recipients not receiving" was disabled integration + empty credentials — still awaiting customer Meta credentials. This phase closes everything the new brief adds.

## Gap analysis (existing vs required)

| Requirement | Status |
|---|---|
| Frontend submit handler/payload/CSRF/double-submit/loading | EXISTS (app.js 1527–1574: guard, disabled button, 'Submitting…') |
| Accurate UI status (saved vs WhatsApp) | MISSING (static toast at 1562, 1485) |
| Modal-close guard during submit | MISSING (Esc/Close at 5029–5030 ignore submitting) |
| Await notification result in POST /api/feedback; report {success, feedbackSaved, whatsappSent} | MISSING (dispatch is detached; response = record only) |
| Never swallow WhatsApp errors | EXISTS in logs/ledger; MISSING from API response/UI |
| Capture provider message ID per recipient | MISSING |
| Delivery webhook (accepted/sent/delivered/read/failed) | MISSING |
| New message format (🔔/📂/💬/🔗/Feedback ID) | MISSING (current 📢 format) |
| QASE URL in message | MISSING (needs full run id + QASE_PUBLIC_URL) |
| Per-attempt logs (provider/endpoint/HTTP/message id/status) | PARTIAL (has status+reason; add endpoint+message id) |
| Recipient normalization/dedupe | EXISTS (E.164, + prefix, dedupe) |
| Per-recipient results, no early stop | EXISTS |
| Env verification in deployed environment | DONE for current env; re-verify after changes |
| Independent backend test without UI | MISSING (CLI/script) |
| Error taxonomy (token/phone-id/recipient/template/payload/rate/timeout/outage/webhook/exception) | MOSTLY EXISTS in classifier; verify coverage + name mapping |

## Phase 1 — Notifier v3: message IDs, new format, per-attempt logs, delivery webhook
Files: server/whatsappNotifier.js, whatsappNotifier.test.js.
- Parse provider 2xx body: capture `messages[0].id` per recipient → store `whatsappMessageId` on the recipient ledger entry; log it.
- New message format (replaces 📢):
  🔔 New QASE User Feedback / ⭐ Rating: X/5 / 📂 Category: … (default 'General' when unset) / 💬 Feedback: … / 👤 User: … / 🕒 Submitted: … / 🔗 QASE: {qaseUrl} / Feedback ID: {id}.
  qaseUrl = QASE_PUBLIC_URL (env, already present) + `/run/{runId}` (full id). Template mode body params updated to the same 7 fields.
- Per-recipient attempt log line gains: provider ('meta-cloud-api'), endpoint (path only, never query/auth), HTTP status, messageId, deliveryStatus, errorCode+message (sanitized).
- Delivery tracking fields on recipient: deliveryStatus (accepted|sent|delivered|read|failed|unknown), deliveryUpdatedAt. HTTP 200 alone NEVER sets 'delivered'.
- Webhook ingestion method `recordDeliveryStatus({messageId, status, timestamp, errorCode})` updating ledger entries by messageId; unknown ids ignored (logged).
- Error taxonomy mapping test: missing token (config invalid), expired/invalid token (401/403 auth_failed), bad phone id (routing error → whatsapp_rejected), invalid recipient (whatsapp_rejected), template rejection, bad payload (400), rate limit (429), timeout, outage (5xx), webhook failure (recordDeliveryStatus corruption), server exception (dispatch catch).

## Phase 2 — Awaited result contract + webhook endpoint + independent test
Files: server/app.js, new server/whatsappWebhook.test.js, whatsappNotifyApi tests, scripts/test-whatsapp.mjs.
- POST /api/feedback: after feedback.create, AWAIT the dispatch with a bounded timeout (env QASE_WHATSAPP_RESULT_TIMEOUT_MS, default 10_000; never hangs feedback). Response becomes:
  `{ ...record, feedbackSaved: true, whatsappSent: <all recipients accepted>, whatsapp: { status, recipients: [{to, state, whatsappMessageId, deliveryStatus}] } }`
  On timeout/pending → whatsappSent:false, whatsapp.status:'PENDING' with message 'Feedback saved, but the WhatsApp notification result is pending.' On provider failure → 'Feedback saved, but the WhatsApp notification failed.' Existing record fields unchanged (backward compat).
- Webhook routes: GET/POST /webhooks/whatsapp (outside /api auth gating — verify middleware ordering; exempt path explicitly). GET: Meta verification (hub.mode/hub.verify_token vs QASE_WHATSAPP_WEBHOOK_VERIFY_TOKEN, echo hub.challenge). POST: bounded JSON, extract entry[].changes[].value.statuses[] → recordDeliveryStatus; always 200 to Meta (never leak internals).
- New env keys: QASE_WHATSAPP_WEBHOOK_VERIFY_TOKEN (secret, optional — webhook disabled/403 without it), QASE_WHATSAPP_RESULT_TIMEOUT_MS (default 10000).
- Independent backend test: scripts/test-whatsapp.mjs — loads env, constructs the notifier, sends a TEST notification to a chosen recipient (`--to`, default first configured), prints sanitized result incl. message IDs; exit non-zero on failure. No UI involved.

## Phase 3 — Frontend accurate status + close guard
Files: public/app.js, public/styles.css.
- Read the new response fields: replace static toast/in-modal text with: 'Feedback saved ✓' + WhatsApp line: 'WhatsApp notification sent ✓' | 'WhatsApp notification failed ✗' | 'WhatsApp notification pending' (disabled → omit line entirely).
- In-modal submitted state shows per-recipient delivery state summary when available (n sent · m delivered).
- Close/cancel guard: while state.feedback.submitting, Esc/close attempts show 'Submission in progress…' instead of closing (dialog 'cancel' event preventDefault).
- Loading: keep button text; inputs disabled during submit to complete the loading state.
- No WhatsApp data cached in localStorage; token/number references must remain absent from public/ (grep gate in tests).

## Phase 4 — Verification, deployed-env proof, root-cause report, publish
- Full suites + new webhook/contract tests; regression: feedback CRUD/report/timer.
- Deployed env re-verification (get_project_details vs container /drytis-config env): token/phone-id STILL customer-supplied — without them, real delivery remains blocked and the report says so honestly; webhook subscription requires Meta app config (customer dependency).
- Browser E2E of the 15-step flow as far as truthfully possible (submission, saved, accurate status display 'WhatsApp failed/pending' expected while disabled); with credentials (if provided) prove message IDs + delivery statuses.
- Root-cause report (8 points per brief) + publish to origin/MANOJ. (DEV push is a separate ask.)

## Acceptance criteria
- [ ] POST /api/feedback response reports feedbackSaved and whatsappSent truthfully per actual provider results.
- [ ] Recipient ledger entries carry provider message IDs and delivery status that only webhooks advance beyond 'accepted'.
- [ ] UI shows saved/WhatsApp status separately; no false success.
- [ ] Message format matches the 🔔 brief incl. category, QASE URL, feedback ID.
- [ ] Webhook endpoint verifies Meta's challenge and ingests statuses without auth bypass elsewhere.
- [ ] Independent script can send a test notification and report message IDs, no UI needed.
- [ ] No token material in frontend/localStorage/console/API/logs/Git.
- [ ] No regressions in feedback, reporting, timer, QA runs.
