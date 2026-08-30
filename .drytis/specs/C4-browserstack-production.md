# C4 — BrowserStack Productionization (v2, rebuilt after the 2026-08-27 loss)

Status: IMPLEMENTING (Phase 2, approved 2026-08-29). Supersedes the lost v1
implementation and its lost spec; rebuilt from the Phase 1 audit of the
repository at `main @ 2a22a74`.

## 0. Context and provenance

- The original C4 (secretStore.js, agent attach, Settings UX) was destroyed,
  uncommitted, in the 2026-08-27 container restart
  (`.drytis/notes/restart-wipes-uncommitted-work.md`). The original spec was
  destroyed with it. This document re-creates the spec from the Phase 1 audit
  plus the approved Phase 2 design decisions (2026-08-29 user approval).
- One artifact of the lost build survives in runtime data:
  `.qase/config.json` → `browserstackKeyEnc: "enc1:…"` (95 chars), with
  `browserstackEnabled: true`, `browserstackUser: "c4_****er"`,
  `browserstackLastVerified.ok = false, code = missing_credentials`.
  **Disposition (approved decision 2):** treat as an orphan. Never attempt
  recovery with guessed logic. If the final secret store cannot decrypt it,
  surface a `browserstackNeedsReentry` state and require the operator to
  re-enter the key. (Expected outcome: undecryptable — its master key/derivation
  is unknown — so the first operator action after deploy is re-entry.)
- Master secret: `QASE_SECRET_KEY` is registered as a platform env key
  (backend env_keys id 48911, `is_secret`, description: "C4 — master passphrase
  for encrypting secrets at rest (BrowserStack key). scrypt-derived AES-256-GCM
  key; never logged; stored in .env (gitignored)") and is materialized in
  `/workspace/.env`. It survives container restarts because it lives in the
  platform backend, not the workspace.

## 1. Scope (approved)

Bring BrowserStack to production grade along three axes:

1. **Credential storage** — encrypt the BrowserStack access key at rest.
2. **Connection UX** — truthful Settings state incl. needs-re-entry.
3. **Autonomous-mission execution** — an agent mission can explicitly request
   BrowserStack as its execution provider; when it does, the mission runs on
   BrowserStack or fails truthfully. It NEVER silently runs local Chromium.

Out of scope (and forbidden to modify — hard boundaries):
C3 decision/autonomy logic, mission budget authority / governor, targetGuard /
SSRF implementation, B1 authentication (requireApiToken / integrationAuth),
C3 finding-quality rules, Pulse / OpenAPI (`/api/v2`, `openapiDocument.js`),
and anything unrelated to the three axes above.

## 2. Design

### 2.1 Secret store — `server/secretStore.js` (new)

Envelope format (stored as the `browserstackKeyEnc` field of
`.qase/config.json`):

```
enc1:v1:<saltB64url>:<ivB64url>:<tagB64url>:<ctB64url>
```

- Key derivation: `scrypt(masterKey, salt, 32, { N: 16384, r: 8, p: 1 })`.
- Cipher: AES-256-GCM, 12-byte random IV, AAD fixed to `qase:secretstore:v1`.
- Master key source: `process.env.QASE_SECRET_KEY` (trimmed). Never logged,
  never returned by any API, never written into any store.
- API:
  - `hasMasterKey(env?)` — boolean.
  - `encryptSecret(plaintext, {env?})` → envelope string (throws on missing
    master key / empty plaintext).
  - `decryptSecret(envelope, {env?})` → `{ ok: true, value }` or
    `{ ok: false, code }` with codes `missing_master_key | invalid_envelope |
    corrupt_envelope | wrong_master_key | empty`. Error paths carry **no**
    plaintext and **no** key material. Implementation note (review-verified):
    GCM cannot distinguish a wrong master key from tampering, so
    `corrupt_envelope` and `wrong_master_key` both surface as
    `wrong_master_key` — the codes are synonyms in v1 and callers must
    treat them identically (needs-re-entry).
  - `describeEnvelope(envelope)` → `{ ok, version }` — safe for logging.
- `.qase/config.json` remains the storage location (approved decision 1). No
  `.qase/secrets/` tree — the audit proved it unnecessary (`.qase/` is wholly
  gitignored and `atomicWrite` already serves `config.json` at mode 0600).

### 2.2 Config integration — `server/config.js` (modified)

- `readStored()`: after parsing, if `browserstackKeyEnc` exists and
  `browserstackKey` does not, decrypt it **in memory only** into
  `stored.browserstackKey`. On failure, set an internal
  `stored.__bsKeyNeedsReentry = true` (internal marker; never persisted, never
  exposed raw). Decryption results are cached per-envelope so `getConfig()`
  does not re-derive scrypt on every call.
- `saveConfig()`: a non-empty `browserstackKey` patch is **encrypted** into
  `browserstackKeyEnc` when a master key is available; the plaintext field is
  deleted from the persisted shape. An empty-string patch clears BOTH
  `browserstackKey` and `browserstackKeyEnc` (existing Clear semantics kept).
  Legacy plaintext at rest is opportunistically migrated to an envelope on the
  next save.
- **Graceful degradation (deliberate):** with no `QASE_SECRET_KEY` in the env
  (fresh clones, the offline `browserstack-trust` subprocess suite), behavior
  falls back to the pre-C4 plaintext flow with a one-time console warning.
  This is required to keep the existing gate suite green in environments
  without the master key; in THIS deployment the master key is present, so
  credentials are always encrypted at rest.
- The B0.1 precedence carve-outs (stored beats env for
  browserstackUser/Key/Enabled; strict default true) are kept **byte-identical**
  — `tests-real/b0-baseline.test.js` greps the source for them.
- `getPublicConfig()` additions: `browserstackKeyEncrypted: boolean` (an
  envelope is stored), `browserstackNeedsReentry: boolean` (envelope present
  but undecryptable). `browserstackCredentialSource` becomes `'none'` when the
  envelope is undecryptable. No raw key in any public shape (unchanged).

### 2.3 Shared caps — `server/browserstackCaps.js` (new; extracted)

`resolveLaunchPlan` and `BROWSERSTACK_OS_MAP` move verbatim from `replay.js`;
`replay.js` imports and **re-exports** `resolveLaunchPlan` so existing imports
(`tests-real/device-execution.test.js`, `tests-real/execution-provenance.test.js`)
keep working. replay's CDP URL construction is extracted as
`buildBrowserstackCdpUrl(caps)`. No second, independent caps builder exists.

New (agent-facing) additions in the same module:

- `resolveAgentExecutionPlan({ device, explicitProvider, config })` →
  `{ mode: 'local' }` or `{ mode: 'browserstack', caps, browserType, osInfo,
  device, strict: true }` or `{ unsupported, error }`.
  - Explicit `provider: 'browserstack'` selects BrowserStack **regardless of
    the global `browserstackEnabled` flag** (explicit mission request wins),
    but requires usable credentials (`browserstackUser` + decryptable
    `browserstackKey`) — missing/needs-re-entry credentials produce a
    deterministic error, never a local run.
  - The global `browserstackEnabled` flag alone does NOT reroute agent
    missions (approved decision 3: no implicit provider switching; the flag
    continues to govern the replay/test-case path only).
  - Device handling mirrors replay's B0.3 semantics: BS-real-device →
    real-device caps; other devices → deterministic `unsupported` error.

### 2.4 Agent attachment — `server/agent.js` (modified) + `server/browserstackAgentRuntime.js` (new)

The SDK (`@cleanslate/sdk` `CleanSlateNodeBrowserAutomation.ensureContext()`)
lazily launches local Chromium into `this.browser` / `this.context`. The
attachment pre-populates both fields with a `chromium.connectOverCDP(...)`
BrowserStack browser + context **before the SDK's first `ensurePage()`**, so
`ensureContext()` finds a context and never launches local Chromium. This is
the same seam the device-context code already uses (`applyDeviceContext`
swaps `service.context`); no SDK modification, no assumption of SDK CDP
support (approved decision 7).

- Ordering inside `ensureRuntime()`: SSRF boundary wrap → BrowserStack attach
  (if the session explicitly requests it) → device-context wrap **skipped**
  for BrowserStack sessions (device semantics are carried by the caps; a
  BS-real-device page IS the device).
- `registerPage` funnel: the existing targetGuard wrap stays exactly as-is and
  wraps every page the SDK registers — including BrowserStack pages
  (per-page CDP Fetch boundary continues to classify navigations). targetGuard
  itself is untouched.
- Truthful stamping: on successful attach,
  `session.execution = buildExecutionEnvironment({ provider: 'browserstack',
  device, browser, os, osVersion, engineEmulated: false, executedOn })` —
  real-device osVersion stays `null` (not observable via CDP; B0.3 rule).
- Failure semantics (approved decision 4): attach failure (bad credentials,
  CDP unreachable, unsupported device) throws a `BrowserStackMissionError`
  out of `ensureRuntime` → the session/mission fails truthfully. **Never**
  launches local Chromium, never falls back, strict always.
- Disposal: the existing `service.dispose()` closes `this.browser` — for a
  CDP-attached browser this releases the BrowserStack session.

### 2.5 Mission / session plumbing — `server/index.js`, `server/store.js` (modified)

- Session creation gains an optional `executionProvider`
  (`'browserstack' | 'local'` — anything else is a 400). Persisted on the
  session by `createSession(options)`; serialized in `GET /api/sessions/:id`
  alongside the new `execution` provenance object.
- Missions select it via `constraints.provider` (or top-level
  `executionProvider`) on the mission-create/start/iterate/revalidate routes —
  the same pattern and validation sites as `constraints.device`. All
  mission→session call sites pass it through. The mission record carries it
  inside `constraints` verbatim (no missions.js change).
- No C3/governor/decision-engine code is touched: the provider is resolved at
  session creation from mission configuration only — the LLM never gets a
  tool or capability to change it.

### 2.6 Settings UX — `public/app.js`, `public/index.html` (modified, additive)

The existing BrowserStack section is extended (not replaced): when
`browserstackNeedsReentry` is true, the last-verified line shows a clear
"credentials need to be re-entered" warning and the key field's placeholder
says so; when `browserstackKeyEncrypted` is true the key placeholder notes the
key is stored encrypted. Save/Test flows unchanged (a re-entered key simply
overwrites the orphaned envelope).

### 2.7 Finding provenance — `server/qaTools.js` (modified, minimal)

`report_finding`'s environment block: when the session executed on
BrowserStack (`session.execution`), the finding carries that environment
verbatim (`provider: 'browserstack'`, truthful device/engineEmulated). Local
missions keep today's exact local-emulation block. This keeps
Mission → Session → ExecutionEnvironment → Evidence → Finding provider
information consistent end to end.

## 3. Files added / modified

**Added:** `server/secretStore.js`, `server/browserstackCaps.js`,
`server/browserstackAgentRuntime.js`, `tests-real/c4-secret-store.test.js`,
`tests-real/c4-config-encryption.test.js`, `tests-real/c4-agent-browserstack.test.js`,
this spec.

**Modified:** `server/config.js`, `server/replay.js` (extraction +
re-export only), `server/agent.js`, `server/index.js`, `server/store.js`
(additive session fields), `server/qaTools.js` (env block), `public/app.js`,
`public/index.html` (additive), `.env.example` (fixes stale
`BROWSERSTACK_USERNAME/ACCESS_KEY` doc to the real `QASE_BROWSERSTACK_*`
names).

**Untouched (boundary):** decisionEngine.js, midSessionProbe.js,
missionGovernor.js, autonomy*, targetGuard.js, integrationAuth.js,
openapiDocument.js, pulseV2Router.js, pulseProjection.js, apiUsage.js,
missions.js, browserBridge.js, capabilities.js, scheduler.js,
validationExecutorCore.js.

## 4. Acceptance criteria (from the approved list, mapped to tests)

Unit / subprocess (always run):
- [ ] encrypt/decrypt round-trip; tamper detection (`wrong_master_key` /
      `corrupt_envelope`); invalid envelope; no plaintext in any error.
- [ ] With a master key: saving credentials writes `browserstackKeyEnc`
      (`enc1:` envelope) and **no plaintext key** anywhere in config.json.
- [ ] Simulated process restart (fresh module import, same data dir)
      preserves credentials.
- [ ] Failed connection test does NOT erase stored credentials
      (lastVerified-only write path).
- [ ] Invalid credentials fail clearly (`invalid_credentials` code, existing
      probe messages) — no fake success.
- [ ] Orphaned/undecryptable envelope → `browserstackNeedsReentry: true`,
      `browserstackCredentialSource: 'none'`, no throw at boot.
- [ ] Precedence carve-outs intact (stored beats env; Clear removes both
      plaintext and envelope).
- [ ] `resolveAgentExecutionPlan`: explicit browserstack + valid-shaped creds
      → browserstack mode w/ correct caps; missing creds → deterministic
      error; non-real device → `unsupported`; no explicit request → local.
- [ ] Agent attach: on failure with garbage credentials →
      `BrowserStackMissionError`, and the SDK's local `ensureContext()` is
      NEVER invoked (no local Chromium launch).
- [ ] Provenance consistency: mission constraints.provider →
      session.executionProvider → session.execution → finding.environment all
      agree; a BS real-device session yields REAL_DEVICE taxonomy; local
      yields VIEWPORT/EMULATED_DEVICE exactly as before.
- [ ] Existing replay BrowserStack behavior unchanged
      (`device-execution`, `execution-provenance`, `browserstack-trust`
      suites stay green through the re-export).
- [ ] Raw BrowserStack credentials never appear in logs/API/evidence
      (existing security + contract suites extended with envelope cases).
- [ ] **Production-shape regression (review round 2)**: driving an explicit
      browserstack session end-to-end via the live API yields a truthful,
      coded failure (or BS execution) — NEVER a TypeError crash, and never a
      silent local run. `planSessionExecution` takes the effective config as
      an explicit argument from `agent.js` (`getConfig()`); no session-level
      config-override field exists in production.
- [ ] **Governor-queue regression (review round 2)**: the queued/grant
      mission start path (`startQueuedMission`) passes the mission's
      provider constraint into `createSession`, exactly like every other
      mission-start path — an explicitly-requested BrowserStack mission
      never silently downgrades to local Chromium while sitting in the
      concurrency queue.

Live (server up):
- [ ] PUT /api/config with credentials → GET /api/config exposes only
      `hasBrowserstackKey` / hints; POST /api/config/test-browserstack with
      invalid creds → clear failure; credentials still present afterwards.
- [ ] Process restart of the live server (`procmgr restart qase-server-v2`)
      preserves encrypted credentials end-to-end (API-visible).
      (Full **container** restart is verified at publish/deploy time — it
      cannot be exercised safely mid-session because the container restart
      wipes uncommitted work, per the 2026-08-27 incident.)

Browser (tester):
- [ ] Settings shows the BrowserStack section with truthful state, and the
      needs-re-entry warning when the stored envelope is undecryptable.
- [ ] New-session API surface (`POST /api/sessions` via any client) accepts
      `executionProvider` and rejects unknown providers with a 400.

Files changed vs actual (post-review manifest correction): `public/index.html`
and `public/styles.css` required NO changes — the BrowserStack Settings
section and new states are rendered by `public/app.js` from existing markup.
Reviewed modules and files, final: **added** `server/secretStore.js`,
`server/browserstackCaps.js`, `server/browserstackAgentRuntime.js`,
`tests-real/c4-secret-store.test.js`, `tests-real/c4-config-encryption.test.js`,
`tests-real/c4-agent-browserstack.test.js`, this spec; **modified**
`server/config.js`, `server/replay.js`, `server/agent.js`, `server/store.js`,
`server/index.js`, `server/qaTools.js`, `public/app.js`, `public/executionDetail.js`,
`public/shared.js`, `.env.example`.

Round-3 additions (tester findings): `public/executionDetail.js` — provider
label prefers the session's explicit `executionProvider` over the resolved
device context (a failed BrowserStack session labels itself `browserstack`,
never a local Chromium run; new `BROWSERSTACK_FAILED` mode). `public/shared.js`
— `api()`/`apiRaw()` no longer let a caller's `headers` key clobber the
token-attached headers spread into fetch (pre-existing defect: "New run"
401'd for authenticated users).

Regression: `npm run test:gate` + targeted suites
(`browserstack-trust`, `device-execution`, `execution-provenance`,
`b0-baseline`, `b0-restart-config`, `b1-crash-restore`, `contract-baseline`,
`security`, `truthfulness`) all green. No commit/push until all pass.

## 5. Open risks / notes

- The orphaned `enc1:` envelope will surface as needs-re-entry by design.
- `browserstackEnabled=true` + undecryptable key (today's runtime state)
  continues to mean "BrowserStack not selected" for replay runs (no usable
  key ⇒ `resolveLaunchPlan` local mode) — unchanged, honest behavior.
- Agent BrowserStack sessions do not use local device-context swapping; BS
  real-device semantics come from the caps (device list limited to
  `BROWSERSTACK_REAL_DEVICES`, consistent with replay).
