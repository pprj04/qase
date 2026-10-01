# Phase 5 QA launcher model-config gate bug — FIXED (verified 2026-10-01)

## Original bug (prior test round)
Clicking "Start test" in the QA launcher always short-circuited with
"The model endpoint is not configured yet. Finish setup in Settings first."
even though GET /api/config returned ready:true — the launcher's config status
was stale from signed-out state (401), blocking the URL and security-gate
validation errors from ever displaying.

## Fix (verified in this round)
- Config status now re-fetches on sign-in (network log shows fresh GET /api/config → 200
  immediately after login, right after GET /api/sessions → 200).
- Submit path re-validates live against current config state.

## Verification (exact repro: sign out → sign in as accounts[0] → open launcher)
- URL gate: "not-a-url" + security tests deselected → "Enter a valid http(s) URL." ✔
- Security gate: https://example.com + one security test checked + authorization
  unchecked → "Confirm the target is an explicitly authorized, isolated test
  environment before running security tests." ✔
- No POST /api/sessions in network log — no run accidentally created. Dialog
  closed via Cancel.
- Console clean: only known favicon 404 + expected pre-login 401s.

Verdict: both prior FAILs now PASS. Remaining for Phase 5 per reviewer
(review-14027-react-phase5.md): ensureModelConfigured semantics, per-session
stage override, narrow-width viewer overlay regression, uncommitted work.
