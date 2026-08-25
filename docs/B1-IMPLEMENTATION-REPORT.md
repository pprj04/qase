# B1 Implementation Report — Integration Contract + Security Boundary

Status legend: DONE (live-verified) / PARTIAL / KNOWN LIMITATION / NOT IMPLEMENTED.

## Phase 0 audit

`docs/B1-PHASE0-AUDIT.md` — exact route inventory: 124 app routes +
34 phaseRouter routes; 58 anonymous GETs pre-B1; `QASE_INTEGRATION_SECRET`
had zero consumers; workspaceId stored but never enforced; mission
idempotency fields existed with zero callers; webhooks were fire-and-forget
and unsigned; `context.maxTurns` never reached the agent (agent.js read
global settings only).

## W1 — Integration authentication — DONE

- `server/integrationAuth.js`: HMAC-SHA256 (`QASE-HMAC-SHA256
  keyId:ts:nonce:sig` over `METHOD\nPATH\nts\nnonce\nbodyDigest`),
  env-only secret, timing-safe compares, nonce replay protection, 10-minute
  freshness window, stable 401 envelope, principals admin+integration
  persisted in `.qase/integrations.json` (P4.4 corrupt-preserve load).
- Raw body captured via `express.json` verify hook → signatures cover exact
  bytes.
- Decision record (HMAC vs JWT) documented in the module header and the
  integration guide.
- Evidence: `tests-real/b1-integration-auth.test.js` **20/20**; live probes
  (unknown_key / bad_signature / replayed_nonce / stale_signature / OK).

## W2 — Workspace authorization — DONE

- `workspaceOfMission()` + `workspaceMatches()` enforced on every
  integration mission/finding/evidence/report/revalidate/stop/start route.
- **Session-born finding linkage fix:** autonomous-run findings are persisted
  by `sessionId` (not `missionId`). The finding-revalidate and
  validation-status routes now resolve ownership via
  `finding.sessionId → mission` when `finding.missionId` is absent. The
  findings route merges `listFindings({ sessionId: mission.sessionId })`
  alongside `listFindings({ missionId: mission.id })` so external consumers
  see all findings for their mission. `startMissionExecution` now stamps
  `session.missionId` at the start call-site so future findings carry the
  direct linkage.
- Matrix verified live: A→A 200, A→B 403 `workspace_forbidden`, anon 401,
  missing → 404 for both workspaces (no existence leak), B cannot stop A's
  mission (403 before any state change), admin reads all.
- Session-born finding matrix verified live: admin revalidates own
  session-born finding → 202; wsA → 403 `workspace_forbidden`; validation-status
  route enforces the same.
- Evidence: `b1-integration-auth.test.js` 20/20, `b1-session-finding-linkage.test.js`
  4/4 (self-contained: creates fixture mission + synthetic session-born finding,
  cleans up in finally), live curl matrix.

## W3 — Anonymous read surface closed — DONE

- Exact inventory (not the estimated "~60"): 52 anonymous app GETs + 6
  effective phaseRouter GET exemptions = 58 closed.
- `PUBLIC_READ_GET` in index.js is now `[]`; `/api/findings/grouped` auth
  fixed (the `/:id` shadow comment resolved); `/api/artifacts/*` requires
  auth.
- Only public route: `/api/health`.
- SSE `EventSource` can't send headers → the stream route accepts the
  server-supported `?token=` query (UI updated, app.js `connect()`).
- UI boot fetches updated to the authed shared helpers (`api()`, new
  `apiRaw()` for text/blob bodies) across app.js, bugs.js, pipeline.js,
  executionDetail.js; a first-run token gate was added to index.html.
- Live matrix: every previously-anonymous route now 401 anon / 200 authed.
- Test contracts updated where they froze the OLD open posture:
  security-detection (S7), contract-baseline, mission-governor, phase17-api
  — each updated to assert the NEW contract with rationale comments.

## W4 — Idempotency + correlation — DONE

- `Idempotency-Key` on POST `/api/v1/integration/missions`:
  workspace-scoped composite key stored **on the mission** → restart-safe
  (missions.json is a P4.4 persisted store). Replay → 200 with
  `idempotentReplay: true` and the original missionId. Same key in a
  different workspace → independent mission (verified).
- **Request fingerprint (review MUST-FIX 3):** the server stores a
  `idempotencyFingerprint` (SHA-256 over the semantic mission fields — name,
  type, targetUrl, context, constraints, autoStart) on the mission. Same key +
  same fingerprint → 200 replay. Same key + **different** fingerprint (e.g.
  maxTurns 8 then 100) → **409 `idempotency_key_reused`** — never a silent
  re-point. Covered by `b1-security-negative.test.js` (same key/different
  body → 409) and live-verified.
- `X-Correlation-Id`: validated (1–128 URL-safe), echoed on every response,
  stamped onto missions, propagated to webhook deliveries (`X-Correlation-Id`
  header), generated `cid_<uuid>` when absent. Golden flow verified
  request→response→mission→webhook chain with one id.

## W5 — Webhooks — DONE

- `server/webhookDelivery.js`: subscriptions + deliveries persisted
  (`.qase/webhook-subscriptions.json`, `.qase/webhook-deliveries.json`,
  atomic writes, debounced + shutdown flush registered in the P4.4 registry;
  pending deliveries resume on boot).
- Signing: `X-Qase-Signature: v1=hex(HMAC-SHA256(secret, "<ts>.<body>"))`,
  `X-Qase-Timestamp` unix seconds. Events: `mission.completed`,
  `mission.failed`, `finding.revalidated`.
- **Event envelope (review MUST-FIX 5):** every delivery carries `id`
  (`evt_<uuid>`, unique per delivery — the dedupe key), `event`, `ts`,
  `workspaceId` (explicitly `null` for admin-created missions — always
  present, never omitted), `correlationId`, `attempt`, plus the event
  payload. Header `X-Qase-Event-Id` mirrors `id` so receivers detect
  duplicate deliveries. Retry schedule is deterministic and documented:
  1s/4s/16s/64s/256s, 5 attempts, then recorded failed.
- Retry: 5 attempts, backoff 1s/4s/16s/64s/256s, 8s delivery timeout;
  per-attempt SSRF re-validation via the existing targetGuard
  (never bypassed).
- `mission.failed` fired from a single `missionBus.on('updated')` listener
  (catches every failure path); `finding.revalidated` from the Phase 18
  `validationBus`.
- **Restart-recovery proof (live):** mission completed → receiver returned 503
  for 2 attempts (backoff 1s+4s) → 16 pending deliveries with attempts=3 at
  the moment of server restart → `procmgr restart` → boot pump re-loaded
  deliveries from `.qase/webhook-deliveries.json` → re-drove pending → receiver
  accepted → `status: delivered` in the ledger. PASS.
- Evidence: `b1-webhook-delivery.test.js` 7/7; golden flow received
  `mission.completed` with a verified signature + correlation id; golden flow
  8c proved retry-with-backoff (receiver returned 500 × 2 → 200 on attempt 3).
- KNOWN LIMITATION: `verifyWebhookSignature` in the reference client is a plain
  comparison (test helper); receivers should use constant-time compares —
  documented in the guide.

## W6 — Mission maxTurns enforcement — DONE (critical requirement)

- **Turn metric definition (review MUST-FIX 4):** one **turn** = one
  `assistant_turn_start` event from the agent stream = one full agent-loop
  iteration (model invocation + tool executions + intermediate reasoning).
  NOT a single model invocation, tool call, or streamed token. Sub-iterations
  inside one `assistant_turn_start` window count as ONE turn.
  `session.turnCount` is incremented only on this event — never fabricated,
  never derived from operation counts. Documented at `agent.js` (TURN METRIC
  comment) and `docs/integration-guide.md §4b`.
- Contract: `context.maxTurns` (or `maxTurns`) must be an integer 1–500;
  anything else → `400 invalid_max_turns` (reject, not silent clamp —
  documented). Precedence: mission context > stored config default (120);
  hard ceiling 500 enforced at create.
- Execution path fixed: create/start/revalidate stamp
  `session.maxTurns`; `agent.js` computes `effectiveMaxTurns =
  session.maxTurns ?? settings.maxTurns` and passes it to the SDK; an
  **independent hard-abort** counts `assistant_turn_start` stream events and
  stops the turn loop at the limit even if the SDK misbehaves. The agent
  then receives a forced wrap-up prompt ("turn budget exhausted — report
  honestly from evidence collected").
- Proof (deterministic): golden flow mission requested 8 → poll showed
  turns 1…8 → completed with `turnCount: 8`, `maxTurns: 8`; earlier probe
  mission requested 3 → exactly 3 SDK turns ("Starting query turn 1..3") →
  completed. No faked counts: `turnCount` comes from the stream events.
- **Start-path + revalidate-path regression:** `b1-start-path-turn-budget.test.js`
  1/1 — creates a mission with `autoStart:false` + `maxTurns=3`, starts it via
  `POST :id/start`, polls to completion, confirms `turnCount ≤ 3`; then
  revalidates and confirms the second iteration also respects the budget.
  (Reviewer round-1 finding: start/revalidate handlers didn't stamp
  `session.maxTurns` — fixed and regression-tested.)

## W7 — Contract, docs, reference client, golden flow — DONE

- `docs/openapi.yaml` (3.1, live-mirroring), `docs/integration-guide.md`,
  `docs/reference-client.md`.
- `examples/reference-client/qase-client.mjs` (zero-dependency) +
  `golden-flow.mjs` (the production gate).
- **Golden flow result (live, external-only client, no UI/browser/internal
  modules/file access): 14/14 PASS** — whoami, signed webhook registration,
  idempotent create (202→200 replay, same id), completion within maxTurns 8,
  correlation id chain, signed `mission.completed` webhook (HMAC verified),
  report/findings/evidence retrieval, mission revalidation 202, 404 negative,
  finding revalidation (skipped when 0 findings), webhook retry proof
  (receiver returned 500 × 2 → delivered on attempt 3).
- Two client-side bugs found and fixed during the run: signature must cover
  pathname WITHOUT query string; webhook receiver must listen on an
  allow-listed loopback port (9930 via `QASE_ALLOWED_LOCAL_TARGETS`, an
  operator extension of the targetGuard — documented, not a bypass).

## W8 — Secret/BrowserStack hygiene — DONE

- `QASE_INTEGRATION_SECRET` read only from env in integrationAuth.js /
  webhookDelivery.js; never in any response, log, or /api/config (masked
  config untouched); grep-verified across server/, public/, docs.
- Webhook ledger test asserts the secret string appears nowhere in persisted
  stores.
- BrowserStack test-pollution guard: `device-execution.test.js` and
  `execution-provenance.test.js` now use **signal-safe restore** —
  `SIGTERM`/`SIGINT` handlers restore the full BrowserStack config
  (enabled/strict/user/key) synchronously before `process.exit`, because
  `finally` does not run when the process is killed by a signal. Verified
  live: both suites pass and leave the config pristine
  (enabled=false, user="", strict=true).
- **Crash-durable restore markers (review SHOULD-FIX 12):**
  `server/testRestore.js` — tests arm a restore marker (snapshot of original
  config written to `.qase/test-restore/<pid>-<ts>.json`) BEFORE mutating;
  `config.js readStored()` calls `restorePendingTestMarkers()` at boot,
  applying every pending marker and removing it after a successful restore.
  If the test process is `SIGKILL`ed / OOM-killed (neither `finally` nor
  signal handlers run), the marker survives on disk and the NEXT server boot
  restores the snapshot. Proven by `b1-crash-restore.test.js`: child
  mutates config + arms marker → `SIGKILL` → fresh module boot restores
  from marker and clears it (1/1 PASS). Uses the existing P4.4 atomic-write
  persistence — no new persistence mechanism.
- `browserstack-trust.test.js` is isolated (temp-dir config) — no live
  mutation, no restore needed.

## Integration surface routes (complete list)

```
GET   /api/v1/integration/whoami
POST  /api/v1/integration/keys            (admin)
GET   /api/v1/integration/keys            (admin)
POST  /api/v1/integration/missions
GET   /api/v1/integration/missions/:id
POST  /api/v1/integration/missions/:id/start
POST  /api/v1/integration/missions/:id/stop
GET   /api/v1/integration/missions/:id/report
GET   /api/v1/integration/missions/:id/findings
GET   /api/v1/integration/missions/:id/evidence
POST  /api/v1/integration/missions/:id/revalidate
POST  /api/v1/integration/findings/:id/revalidate
GET   /api/v1/integration/findings/:id/validation
POST  /api/v1/integration/webhooks
```

Mission start/revalidate share handler bodies with the token-gated
`/api/v1/missions/*` routes (identical guards; no logic fork).

## Regression status (live server)

| suite | result |
|---|---|
| b1-integration-auth | 20/20 |
| b1-webhook-delivery | 7/7 |
| b1-start-path-turn-budget | 1/1 |
| b1-security-negative (AUTH/AUTHZ/IDEMPOTENCY/WEBHOOK/ARTIFACT attacks) | 17/17 |
| b1-crash-restore (SIGKILL → boot recovery) | 1/1 |
| b1-session-finding-linkage | 4/4 |
| b1-live-retry-turns (live webhook retry + turn budget) | 2/2 |
| b0-baseline | 6/6 |
| b0-restart-config (live) | 1/1 |
| device-execution | 22/22 |
| execution-provenance | 65/65 |
| phase18-api | 13/13 |
| phase18-e2e | 10/10 |
| phase16-api | 17/17 |
| phase17-api | 16/16 |
| phase17-e2e | 10/10 |
| phase14-multi-viewport | 44/44 |
| phase11a-findings-store | 27/27 |
| phase10-visual-regression-v2 | 8/8 |
| phase9b-parallel-retry | 11/11 |
| phase9c-artifacts-history | 8/8 |
| e2e-ui journey (Playwright) | 30/31 (1 pre-existing known bug P1-4) |
| phase5-api | 13/13 |
| m1-p4.4-persistence | 28/28 |
| **golden flow (external-only, no UI, no internal modules)** | **14/14** |

### Post-gate regression fixes (B1 surface-closure fallout)

The full production gate surfaced 16 failures in 6 legacy suites — every one
was a test still calling newly-token-gated routes **anonymously** (W3 closed
them by design), or reading the LLM provider URL as the server URL
(reviewer WARN 1). Fixed by updating the tests to the new posture, NOT by
reopening routes:

- `phase14-multi-viewport` — `/api/config` anonymous → now asserts 401 then
  fetches with the token (44/44).
- `phase11a-findings-store` — export routes carry the token (27/27).
- `phase10-visual-regression-v2` — `get()` helper sends the token (8/8).
- `phase9b-parallel-retry` — config/regression GETs carry the token (11/11).
- `phase9c-artifacts-history` — artifact routes carry the token (8/8).
- `phase17-e2e` — `QASE_BASE_URL` → `QASE_TEST_BASE_URL` precedence (10/10,
  live mission run against the benchmark app).
- `e2e-ui/journey.spec.mjs` — seeds `localStorage.qase_token` via
  `addInitScript` so Playwright behaves like an authenticated user, and the
  session list fetch carries the token (30/31, 1 pre-existing known bug).

### Test-isolation bug found and fixed during gate verification

`b1-crash-restore.test.js` was **not hermetic**: `config.js` resolved its
store from `process.cwd()` and ignored `QASE_DATA_DIR`, so the test seeded
and restored against the LIVE `.qase/config.json`, clobbering operator
values (concurrentRuns reverted 3→20, `ORIGINAL_USER` test debris written
into browserstackUser). Fixed both sides: `config.js` now honors
`QASE_DATA_DIR` (unset in production → identical behavior), the test asserts
hermeticity before proceeding, and the live config was restored to operator
values (maxTurns 120, concurrentRuns 3, BS creds cleared). This incident is
exactly the class of pollution the W8 marker system guards against — the
markers themselves never leak across boots (`.qase/test-restore/` verified
empty).

### Reviewer round-2 fixes applied

- `b1-session-finding-linkage.test.js`: fixture now creates the mission with
  explicit `workspaceId: 'wsA'` (admin creating for a target workspace) so the
  wsA/wsB matrix asserts real authorization behavior instead of an accidental
  null-workspace skip. Also reads `QASE_API_TOKEN` (not the nonexistent
  `QASE_TEST_TOKEN`).
- `server/index.js` finding-revalidate: idempotency key is now
  **workspace-scoped** (`${workspaceId}:${key}`, same scheme as mission
  create) — one tenant's key can no longer suppress another tenant's
  validation run.
- `browserstack-trust.test.js`: config read now authenticated (B1 W3 closed
  anonymous reads — 44/44 assertions).
- `b0-restart-config.test.js`: reads `QASE_API_TOKEN` fallback.
- `qase-client.mjs`: clock-skew comment corrected to 5 min.

### Post-review contract hardening (spec review, 6 MUST-FIX / 6 SHOULD-FIX)

Assessed as already satisfied by construction: (1) HMAC-only — no JWT option
anywhere in the implementation; (2) W3 route inventory was enumerated
dynamically from the live router (52 anonymous app GETs + 6 phaseRouter
exemptions closed; `/api/health` the only public GET); (9) correlation-ID
validation regex/length enforced with 400 on malformed. Genuinely fixed:
fingerprint conflict → 409 (W4), event IDs + duplicate-delivery semantics +
always-present workspaceId (W5), security-negative test matrix 17/17, W6
turn-metric definition documented in code + guide, W8 crash-durable restore
markers with boot recovery (SHOULD-FIX 12), golden flow tail extended to
GET-updated-finding-after-revalidation, docs updated for all new contracts.
Deliberate deviation: null-workspace legacy missions resolve ownership via
mission.workspaceId → project.workspaceId → admin-only (documented, not
trusting client input — workspaceId always comes from the authenticated
principal's key binding, never the request body).

## Known limitations / NOT in B1

- No per-user authn, rate limiting, or secret encryption at rest (scoped out
  by the build plan).
- Workspace resolution for pre-B1 legacy missions is best-effort
  (mission.workspaceId → project.workspaceId → null); new integration
  missions are stamped at create.
- `POST /api/v1/missions` (token-gated UI route) also gained idempotency —
  UI callers use `__ui__` namespace.
- Webhook subscriptions are server-global per workspace — no per-mission
  filter API surface yet (matching supports it internally).
