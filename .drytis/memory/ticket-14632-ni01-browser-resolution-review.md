# Review — #14632 NI01 Phase 2 browser support resolution (round 1, 2027-03)

**Verdict: PASS** (0 FAIL, 4 WARN). Full suite 1197/0 fail, targeted 52/0.

## Verified
- `browserSupportResolution.js`: DDG not_supported everywhere (even with BS creds); opera/brave engine_equivalent even with BS creds (BS can't upgrade — BS status is not_supported for them, code falls back to local); safari engine_equivalent local → supported via browserstack flag. Never throws.
- `resolveExecution`: NOT_SUPPORTED gate is FIRST (before BS-environment mode and REAL_DEVICE block). DDG+REAL_DEVICE env → blocked with NOT SUPPORTED reason (dominant, coherent). Non-DDG REAL_DEVICE w/o creds still blocks with REAL DEVICE UNAVAILABLE. browserBridge:546 throws on blocked → DDG can never launch → never PASSED.
- availabilityReport additive browserSupport[]; available/unavailable arrays unchanged (envApi test passes). Live API verified with tester@qase.dev session: macos entry carries correct statuses.
- withExecutionMetadata attaches browserSupport, recomputed per read from process.env (uncached). availability() same.
- UI additive only: matrixColumns renderRow NOT SUPPORTED / "· ENGINE-EQUIVALENT (CHROMIUM/WEBKIT)" meta + title tooltips, textContent (no XSS). Rows stay selectable = spec's "record intent".

## WARNs (not fixed, per role)
1. browserBridge.js:547 blocked error prefix is hardcoded `REAL DEVICE UNAVAILABLE: <reason>` even when reason is DuckDuckGo NOT SUPPORTED — misleading error text for DDG blocks.
2. `/api/catalog/meta` does NOT expose browser support (spec work item 2 wanted availability + meta). Only /api/environments/availability has it.
3. Availability endpoint Cache-Control `private, max-age=300` (pre-existing) — client can hold stale verdicts up to 5 min across credential changes; server always recomputes.
4. No UI-level tests for new NOT_SUPPORTED / ENGINE-EQUIVALENT rendering (spec asked for UI snapshot test); all 11 new tests are server-side. engineForBrowser still maps duckduckgo→chromium (pinned test) — now dead path but stale-semantics.

## Notes
- resolveBrowserSupport ignores platformId (browser-level table); safari resolves engine_equivalent even on windows — harmless since BROWSERS platform membership filters the report, but custom envs could surface odd combos.
- Change is UNCOMMITTED on NIHARIKA working tree (carried from #14631 review) — publish before redeploy.
