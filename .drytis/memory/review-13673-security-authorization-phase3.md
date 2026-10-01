# Review — ticket #13673 "Phase 3 · Authorization gate, scope limits & Stop control" (QASE-2.1)

Initial review: 5 PASS, 1 FAIL (criterion 4), minor WARNs. **Re-review after fix: RESOLVED — all clear.**

## Resolved issues (fix verified 2026-10)
1. **Env knob dead wiring — FIXED.** `agent.js:479` now passes `settings.securityPayloadLimit` to `guardSecurityPayloadTool(...)`; `settings = getConfig()` (agent.js:373) in the same `ensureRuntime` scope, and `getConfig()` applies `clampSecurityPayloadLimit` (config.js:134). Runtime cap now honors `QASE_SECURITY_PAYLOAD_LIMIT` (1–200, default 40).
2. **`.env.example` entry — ADDED.** `QASE_SECURITY_PAYLOAD_LIMIT=40` at line 32 with sibling-style comment including "Bounded 1-200" and not-tested-with-reason guidance.

## Re-review results
- Full suite: `node --test server/securityPayloadBudget.test.js server/securityRunControls.test.js server/agent.test.js server/securityGateUi.test.js server/qaUiSelection.test.js server/qaTestSelection.test.js server/app.test.js server/securityCatalog.test.js server/config.test.js server/securitySelectionUi.test.js` → **104 pass / 0 fail**.
- Verdict: PASS on all 7 criteria of `.drytis/specs/security-authorization.md`.

## Still-open observations (informational, not defects)
- `clampSecurityPayloadLimit` has no explicit floor — ≤0/NaN → default 40 (effective 1–200 range honored).
- Guard counts *all* fill/type/key actions on security runs (routine navigation also burns budget) — conservative by design; relevant for Phase 4 prompt guidance.
- `runRepository.test.js` has no populated-`security_authorization` jsonb hydration test (route-level round-trip is covered via store); coverage gap from Phase 1 review, unchanged.
- Dialog selection resets to default-all-available on close/reopen (documented intentional default-selection behavior).

See also: review-13671-security-catalog-phase1.md, review-13672-selection-ui-phase2.md.
