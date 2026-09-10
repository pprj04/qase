# C4.1 / D2 — STATUS: BLOCKED — REAL BROWSERSTACK CREDENTIALS REQUIRED

**Decision date:** 2026-08-31 (02:43 UTC), by operator after Phase 1 audit acceptance.
**Repo state at decision:** HEAD = `609cd58` (main = origin/main). C4/C4.1 code shipped in `781079e`; D0.5 in `609cd58`.

## Operator directive
- Do NOT modify files, rebuild BrowserStack, create fake credentials, weaken
  authentication, or bypass the real-credential requirement.
- Do NOT claim C4.1 COMPLETE. Do NOT spend additional engineering time on C4.1
  without valid credentials. STOP and wait.

## Recorded status (10 points, audit-verified)
1. Secure credential storage is implemented (`server/secretStore.js`, `enc1:v1`
   scrypt/AES-256-GCM envelope in `.qase/config.json`, key from `QASE_SECRET_KEY`).
2. Connection validation is implemented (`server/browserstackTest.js`: REST Basic
   auth probe of automate/plan.json).
3. Application-level CDP verification is implemented (101 handshake alone is NOT
   success; first app frame → `cdp_reachable`; post-open 1001/1008 auth close →
   `invalid_credentials`; REST 200 cannot launder a CDP rejection).
4. Autonomous BrowserStack execution path is implemented
   (`server/browserstackAgentRuntime.js` attaches before SDK's first
   `ensureContext`; never launches local Chromium for a BrowserStack session).
5. No-silent-fallback behavior is implemented (strict default true; explicit
   provider failure = truthful failure, `BrowserStackMissionError` /
   `BrowserStackStrictError`).
6. Provenance handling is implemented (Mission → Session → ExecutionEnvironment →
   Evidence → Finding; provider must be browserstack|local; unknown → 400).
7. Negative-path testing is complete (c4-1-probe-verdict 9/9, c4-secret-store
   11/11, c4-config-encryption 7/7, c4-agent-browserstack 24/24,
   browserstack-trust 1/1 — all green at audit).
8. Secret-leak testing is complete (zero leaks across logs/API/stores/UI).
9. Restart persistence is verified (service restart + full container restart
   with synthetic creds: envelope survives, keyLength intact, needsReentry
   false; no auto keygen on master-key loss).
10. The ONLY remaining unverified item: valid credentials → real BrowserStack
    remote execution → end-to-end BrowserStack provenance.

## Credential state at block
NOT configured: no `browserstackUser`, no `browserstackKeyEnc`,
`lastVerified` = `missing_credentials`. No production-code changes required.

## Resume procedure (when valid credentials become available)
Operator enters username + access key via Settings → BrowserStack → Save →
Test Connection (secure path; never paste into chat), then run the approved
Phase 2 plan saved in `.drytis/specs/C4-browserstack-production.md` § acceptance
/ this handover: Test 1 connection (app-level verdict + lastVerified), Test 2
restart persistence, Test 3 autonomous mission `executionProvider: 'browserstack'`
vs `http://127.0.0.1:9901/`, Test 4 provenance chain, Test 5 no-fallback
re-verification, Test 6 secret-leak sweep, regression battery, 18-item report.
