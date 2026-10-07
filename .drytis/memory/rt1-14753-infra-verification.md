# Infra verification — RT1 #14753 — 2026-10-05 (post-restart)

RESULT: PASS (0 FAIL, 3 WARN). Context: container was restarted earlier today after
fork exhaustion (zombie `cat` hazard, see rt1-branded-browsers-persistence.md);
services healthy, pids.current=232 after verification.

- All 4 branded binaries PRESENT: /usr/bin/google-chrome-stable + brave/edge/opera
  under /workspace/.local-browsers/ (persistent paths — matches RT1 postmortem fix).
- Spot tests (node --test --test-concurrency=1): localBrowserRegistry.test.js and
  browserSupportResolution.test.js — fail 0 each. Full suite NOT run (per ticket rule).
- DuckDuckGo: NOT_SUPPORTED with reason string in browserSupportResolution.js:66 + localBrowserRegistry.js:88. /api/catalog/meta requires auth (QASE_AUTH_REQUIRED=true) — could not verify payload anonymously; code path covered by passing tests.

## Open WARNs carried forward (not new this run)
1. QASE_BROWSER_ALLOWED_PRIVATE_HOSTS (key 50925) still lists stale literal host
   `qase-2-1-jywqe4.drytis.dev`; current preview is qase-2-1-cvtryq. Also a static
   literal that won't survive project recreation. See dx-phase1-device-picker-infra-verification.md.
2. Test fixtures hardcode old preview hosts (browserPolicy.test.js: qase-2-1-vbvclu)
   and llm.drytis.ai base URL (config.test.js). Test-only, no creds.
3. /workspace/.env.example is not backend-managed (conventional example file; not loaded).
