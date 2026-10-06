# WhatsApp Notifications for User Feedback

Spec for the MANOJ branch. Every piece of the pipeline is backend-only — the
frontend is not touched (no client change, no credentials in client code).

## Provider

No WhatsApp/messaging integration exists in the repo (verified by recon).
Implement against the **official Meta WhatsApp Business Cloud API**
(`POST https://graph.facebook.com/{version}/{PHONE_NUMBER_ID}/messages`,
`Authorization: Bearer <token>`) using the platform `fetch` — no new SDK
dependency. Follow the `server/drytisTransport.js` skeleton: injectable
`fetchImpl`, `AbortSignal` timeout, bounded response reads, typed errors with
a `retryable` flag, `sanitizeErrorDetail()` before any logging.

## Configuration (env, never committed, never frontend)

Registered as project env keys in `/workspace/.env`:

| Key | Secret | Notes |
|---|---|---|
| `QASE_WHATSAPP_ENABLED` | no | strict `true`/`false` (same validation style as `QASE_DRYTIS_INTEGRATION_ENABLED`); unset/`false` → feature off, everything else works |
| `QASE_WHATSAPP_ACCESS_TOKEN` | **yes** | Meta permanent system-user token |
| `QASE_WHATSAPP_PHONE_NUMBER_ID` | no | Cloud API sender |
| `QASE_WHATSAPP_RECIPIENTS` | no | comma-separated E.164; default value = `+918500040108,+918985485377,+918387296764,+919995082647` — changeable without code changes |
| `QASE_WHATSAPP_API_VERSION` | no | default `v20.0` |

Invalid/missing config when enabled → one clear startup/log error naming the
missing key(s); feedback submissions are NEVER blocked by configuration
problems (dispatch disabled + logged, save still succeeds).

## Message format (text message, one per recipient)

```
📢 QASE User Feedback Received

A new user feedback has been submitted after completion of a QASE test run.

⭐ Rating: {n}/5

📝 User Feedback:
{comments or "(no description provided)"}

📊 QA Run:
{session title, e.g. "New QA Run" / SQA title} · {short run id}

🌐 Target:
{targetUrl or "—"}

👤 Submitted By:
{displayName or email prefix or "QASE user"}

🕒 Submitted On:
{dd-MMM-yyyy hh:mm:ss a, run's timezone/locale as elsewhere in reports}
```

Only these fields travel — no tokens, emails beyond display name, no secrets,
no findings/report content.

## Trigger & save-first guarantee

Wired in `POST /api/feedback` (server/app.js ~535-588) AFTER
`feedback.create()` returns and the record is committed:

- Duplicate (`409 duplicate_feedback`) and validation (`400`) paths send
  nothing — the store-level duplicate check is the first idempotency barrier.
- Dispatch is a detached promise (startTurn-style tracked set drained by
  `whenIdle`), never awaited by the response: user sees
  `201` + record immediately; WhatsApp outcome is invisible to the request.
- Any error inside dispatch → `logger.warn`/`error` with `component` context
  via `sanitizeErrorDetail`; feedback stays stored; report unchanged.

## Idempotency ledger

`server/whatsappNotifier.js` keeps a persisted ledger
(`.qase/whatsapp-notifications.json`, atomic tmp+rename, 0600 — same pattern
as feedbackStore) keyed by **feedback record id**:
`{ [feedbackId]: { status: 'pending'|'delivered'|'failed', attempts, lastError?, updatedAt } }`.
Before dispatching, check ledger: a feedback id already `delivered` or
`pending` is skipped. Feedback ids are UUIDs minted per successful save, so
double-click/retry storms collapse to one notification set.

## Failure handling & retry

Per recipient, per attempt: network error / 5xx / timeout / 429 → `retryable`;
4xx (bad token, invalid recipient) → terminal for that recipient, logged.
Bounded in-process retry: up to **3 attempts per recipient**, backoff
(2s × attempt, abortable via test-injectable sleep). Final outcome written to
the ledger. If every recipient fails terminally, ledger status `failed` with
redacted lastError — feedback/report unaffected. (Persistent cross-restart
retry is out of scope; ledger makes failures observable for a future
follow-up.)

Handled explicitly: API unavailable (network/ECONNREFUSED), auth failure
(401/403), rate limiting (429), timeout (AbortSignal), delivery failure
(non-2xx), invalid recipient (400-level), provider body errors.

## Files

- NEW `server/whatsappNotifier.js` — config parser (strict), message builder
  (pure function), Cloud API client (injectable `fetchImpl`), ledger,
  dispatch orchestration. Exports everything needed for tests.
- NEW `server/whatsappNotifier.test.js` — unit: config validation, message
  content (all fields, both QA/SQA modes, missing optional fields),
  idempotency (same feedback id → single send), retry matrix (429/5xx/timeout
  retried; 401/invalid recipient not), save-first (dispatch errors never
  propagate), logging redaction (token never in output).
- `server/app.js` — instantiate via factory `createConfiguredWhatsAppNotifier`
  (returns `undefined` when disabled) at app creation; call after successful
  create; detached dispatch with run context (title, mode, targetUrl,
  submittedBy name via existing user lookup).
- `server/app.test.js` / `server/feedbackApi.test.js` — route-level: real
  HTTP double-submit (409) sends nothing; enabled-with-bad-credentials still
  returns 201.
- Env keys registered via platform env tooling (not hand-edited .env).

No DB migration (ledger is a file; feedback record shape unchanged).

## Acceptance

- Submitting feedback (QA and SQA runs) stores it AND triggers one WhatsApp
  message per configured recipient.
- Message matches the format above; run/mode/target/user/timestamp included.
- Disabled (`QASE_WHATSAPP_ENABLED` unset/false): zero outbound calls, zero
  errors surfaced to users.
- Every failure mode leaves feedback saved, report intact, request 201.
- No duplicate sends across double-submit / API retry.
- Token appears in no log line, no API response, no frontend artifact.
- Existing feedback/timer/reporting suites unchanged (green).
