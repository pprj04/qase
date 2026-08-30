# C4.1 — BrowserStack probe false-positive root cause + fix

## Root cause (proven with controlled raw-WS experiments)
BrowserStack's CDP endpoint (wss://cdp.browserstack.com/playwright?caps=...) completes
the TLS/101 WS handshake for ANY credentials — junk creds included — and only THEN
closes with code 1001 "Invalid username or password". The pre-C4.1 probeCdp in
server/browserstackTest.js resolved success on the WS 'open' event alone, so wrong
pastes got lastVerified ok:true / code 'connected' (false positive).

The REST stage (Basic-auth GET api.browserstack.com/automate/plan.json) returned 200
for the same pair — divergence: REST accepts, CDP rejects. The stored key was 11 chars
ending '27,&' (wrong paste shape; real BrowserStack access keys are ~20 chars).

## Fix (C4.1, server/browserstackTest.js)
- probeCdp verdict now requires an APPLICATION-LEVEL signal: first text frame →
  cdp_reachable; post-open close matching /invalid (username|user) or (password|access
  key)/i → invalid_credentials; other post-open close → cdp_rejected; pre-open close →
  cdp_unreachable; timeout → cdp_timeout/cdp_unreachable. 'open' alone proves nothing.
- makeDefaultWsFactory forwards 'message' events and close reason text.
- Aggregate rule: CDP invalid_credentials outranks REST auth 200 — message explains
  "The REST API accepted the login, but the CDP execution endpoint rejected the same
  credentials — re-copy the username and access key".

## Diagnostic (Fix C)
getPublicConfig now exposes browserstackKeyLength (trim length of the effective key,
0 when absent) — never key material. Settings placeholder shows "stored encrypted, N
chars". An 11-char paste is immediately visible as wrong.

## Gotchas learned
- node:test subprocess capture quirk: spawnSync('--input-type=module', '-e', script)
  CAN return empty stdout when the script prints nothing (seeds). Always have seeds
  pass { json: false } or print something; JSON.parse('') throws 'Unexpected end of
  JSON input'.
- The sessions route reads `executionProvider` from the request BODY (not
  constraints.provider). Missions read constraints.provider. For direct API session
  tests: POST /api/sessions {"executionProvider":"browserstack"} then
  POST /api/sessions/:id/message {"text":...}.
- Explicit browserstack session with invalid creds → truthful 500 "BrowserStack
  execution failed — the mission requested BrowserStack and could not connect", status
  'error', execution null, NO local frame, no local chromium launch. Verified live.

## Tests
- tests-real/c4-1-probe-verdict.test.js — 9 tests (5 offline probe shapes P1–P5 + 4
  config subprocess C1–C4). All green.
- tests-real/browserstack-trust.test.js — updated stubWs('open') to emit the app-level
  frame (old shape = the bug), added 'open_silent', added 1h/1i C4.1 regressions,
  fixed TOKEN fallback (env QASE_API_TOKEN || local token). 50/50.
- Suites verified after fix: c4-secret-store 11/11, c4-config-encryption 7/7,
  c4-agent-browserstack 24 (21 pass/3 skip/0 fail), device-execution 27 (22/5 skip),
  execution-provenance, b0-baseline, b0-restart-config, b1-crash-restore,
  b1-security-negative 17/17, c2-autonomy-contract 18/18, api-contract 31/31,
  security/ 51/51, truthfulness/redteam-truth 18/18, c3-finding-quality 17/17,
  b1-session-finding-linkage 4/4.

## Persistence (verified live)
Save synthetic key → encrypted enc1: envelope on disk, no plaintext → procmgr restart
→ still settings/34/encrypted → full container restart → STILL settings/34/encrypted.
Failed probe retained credentials (only lastVerified updated). Master-key loss (Q4)
→ needsReentry true, source 'none', envelope kept on disk, unrelated config intact,
NO auto keygen.
