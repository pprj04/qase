# QASE Integration Guide

How a completely separate application consumes QASE — create test missions,
wait for execution, receive results, trigger revalidation — **without ever
opening the QASE UI**.

- Contract: the live document at `/openapi.json` on your Qase instance (OpenAPI 3.1, canonical — includes the full integration surface with the `hmacAuth` security scheme). [`docs/openapi.yaml`](openapi.yaml) is the human-readable mirror; parity between the two is enforced by `tests-real/openapi-docs-parity.test.js`.
- Reference client: [`examples/reference-client/qase-client.mjs`](../examples/reference-client/qase-client.mjs)
- Golden-flow proof: [`examples/reference-client/golden-flow.mjs`](../examples/reference-client/golden-flow.mjs)

## 1. Authentication

QASE's integration surface uses **HMAC-SHA256 signed requests**. There is no
login and no bearer token on this surface — every request is signed with the
shared secret `QASE_INTEGRATION_SECRET` (held only in the server's env).

```
Authorization: QASE-HMAC-SHA256 keyId:timestampMs:nonce:signature
```

Canonical string (newline-separated):

```
METHOD
PATH                      # pathname only, WITHOUT query string
timestampMs               # unix milliseconds, ±5 min window
nonce                     # random hex, single-use per key
bodyDigest                # hex(HMAC-SHA256(key="", rawBody))
```

`signature = hex(HMAC-SHA256(secret, canonicalString))`.

Why not JWT: the decision record lives in `server/integrationAuth.js` — a
single-server API with one static token gains nothing from token expiry /
refresh machinery, while a signature binds method + path + body so a
captured signature can't be replayed against a different endpoint.

**Identities.** Keys are registered in `.qase/integrations.json`:

| principal    | workspaceId | scopes |
|--------------|-------------|--------|
| `admin`      | `*`         | all |
| `integration`| one workspace | `mission:create`, `mission:read`, `mission:stop`, `findings:read`, `evidence:read`, `revalidate` |

Register new keys with the admin key via `POST /api/v1/integration/keys`.

**Error envelope** is stable: `401 { "error": { "code": "…", "message": "…" } }`
with codes `unknown_key`, `bad_signature`, `stale_signature`,
`replayed_nonce`, `invalid_auth_header`, `not_configured`.

## 2. Workspaces (authorization)

Every mission belongs to a workspace. An integration key bound to workspace
`wsA`:

- `wsA` mission → **200**
- `wsB` mission → **403 `workspace_forbidden`**
- missing mission → **404** for everyone (no existence leak)

The admin key (`*`) reads all workspaces.

## 3. Create a mission

```js
const { status, json } = await client.createMission({
  name: 'Nightly audit', type: 'smoke',       // smoke | full_audit | …
  targetUrl: 'https://new.drytis.com',
  context: { maxTurns: 8 }                     // 1..500, REQUIRED contract
}, { idempotencyKey: 'nightly-2026-08-25', correlationId: 'cid_my_run_42' });
```

- **202** — created and running (or queued; poll `GET …/:id`).
- **201** — created, not started: call `POST …/:id/start` when ready.
- **200 + `idempotentReplay: true`** — the same `(workspace, Idempotency-Key)`
  **and the same request fingerprint** (SHA-256 over the semantic mission
  fields: name, type, targetUrl, context, constraints, autoStart) was replayed;
  you get the *original* mission back. **Same key + different fingerprint →
  `409 idempotency_key_reused`** (the key was bound to a different request —
  it is never silently re-pointed). Keys are workspace-scoped, survive server
  restarts (stored on the mission), and never collide across workspaces.

## 4a. Webhook event envelope

Every delivery is a signed JSON envelope:

```json
{
  "id": "evt_9f1c…",          // unique per delivery — dedupe on this
  "event": "mission.completed",
  "ts": 1787659391582,         // epoch ms
  "workspaceId": "ws_…",       // null for admin-created missions
  "correlationId": "cid_…",    // the chain from your original request
  "attempt": 3,
  "missionId": "…",
  …event payload
}
```

Headers: `X-Qase-Event`, `X-Qase-Event-Id` (== `id`), `X-Qase-Timestamp`,
`X-Qase-Signature` (`v1=<hex HMAC-SHA256 over timestamp + "." + body>`),
`X-Correlation-Id`. **Duplicate detection:** receivers should treat a repeated
`X-Qase-Event-Id` as a redelivery, not a new event. Retry schedule on
non-2xx: ~1s → 4s → 16s → 64s → 256s (5 attempts total), then the delivery is
recorded as failed; delivery records and pending retries survive restarts.

## 4b. What counts as a turn (maxTurns contract)

One **turn** = one `assistant_turn_start` event from the agent stream — one
full agent-loop iteration (model invocation + tool executions + reasoning),
not a single model invocation or tool call. Sub-iterations inside one
`assistant_turn_start` window count as one turn. `session.turnCount` is
incremented only on this event and is never derived from operation counts.

**maxTurns is enforced for real.** The value flows mission → session → the
agent runtime (`agent.js effectiveMaxTurns`), and an independent hard-abort
counts `assistant_turn_start` stream events and stops the turn loop at the
limit. Requested `8` → actual execution `≤ 8` assistant turns (verified by
the golden flow: requested 8, executed 8, status completed). `> 500` or
non-integer → `400 invalid_max_turns`.

**Exactness note:** the SDK is the primary enforcer and stopped exactly at
the limit in every observed run (8→8, 3→3, 2→2). The backstop fires on the
`(limit+1)`-th turn start and records `turnCount = limit+1` truthfully, after
which the agent gets one budget-exhausted wrap-up turn to produce a report.
So a mission may report `turnCount == N` (normal) or, in the backstop path
only, `N+1` with an abort record — never more.

## 4. Wait for the result

Two supported styles:

**Polling.** `GET /api/v1/integration/missions/:id` until `status` is
`completed | failed | aborted | cancelled`. The payload includes
`turnCount` (actual turns executed), `qualityScore`, `verdict`, `findingsCount`.

**Signed webhook.** Register once (before creating missions):

```js
await client.registerWebhook({
  url: 'https://ci.example.com/qase-hooks',
  events: ['mission.completed', 'mission.failed', 'finding.revalidated']
});
```

Delivery headers:

| header | meaning |
|---|---|
| `X-Qase-Event` | `mission.completed` / `mission.failed` / `finding.revalidated` |
| `X-Qase-Timestamp` | unix seconds — reject deliveries older than your window |
| `X-Qase-Signature` | `v1=hex(HMAC-SHA256(secret, "<timestamp>.<body>"))` |
| `X-Correlation-Id` | the mission's correlation id, when present |

Verify: recompute the HMAC over `<timestamp>.<rawBody>` and compare to the
header (constant-time in your language of choice). Retries: 5 attempts with
1s/4s/16s/64s/256s backoff; delivery state persists in
`.qase/webhook-deliveries.json` and pending deliveries resume after a server
restart. Webhook URLs pass the same SSRF targetGuard as mission targets —
re-validated before **every** attempt.

## 5. Retrieve results

```
GET /api/v1/integration/missions/:id/report        # JSON or ?format=md
GET /api/v1/integration/missions/:id/findings?limit=100&offset=0
GET /api/v1/integration/missions/:id/evidence?limit=100&offset=0
```

## 6. Revalidation

**Mission-level** (`POST …/missions/:id/revalidate`) — a new validation-loop
iteration: the agent re-runs against the stored target with knowledge of
previous findings. Guarded: `409` if already running, past the iteration
limit, or converged (NO_IMPROVEMENT).

**Finding-level** (`POST …/findings/:id/revalidate`) — a Phase 18
fix-validation run: deterministic before/after comparison. The LLM never
selects the fix status; QASE decides from evidence. Poll
`GET …/findings/:id/validation` for the run result
(`VERIFIED_FIXED`, `NOT_FIXED`, `REGRESSED`, `PARTIAL_FIX`, …). Both accept
`Idempotency-Key`.

## 7. Correlation ids

Send `X-Correlation-Id` (1–128 URL-safe chars) on any request. It is echoed
on the response, stamped onto the created mission, and carried into webhook
deliveries. The server generates `cid_<uuid>` when you omit it.

## 8. Security posture (B1)

- Anonymous API reads are closed (only `/api/health` is public). The UI
  attaches its token automatically (Settings → API Token).
- `QASE_INTEGRATION_SECRET` never appears in any API response, log line, or
  the config endpoint.
- All target and webhook URLs go through the SSRF targetGuard.
- Rate limiting, secret encryption at rest, and per-user authn are
  deliberately out of B1 scope (documented gaps for a later build).
