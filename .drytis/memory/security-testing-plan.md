# Security testing category — planning decisions (2026-09-29)

Specs at `.drytis/specs/security-catalog.md`, `security-selection-ui.md`,
`security-authorization.md`, `security-execution-reporting.md`. Four phases →
four board tickets.

Key decisions:
- Catalog gains `category` ('standard' | 'security') + `availability`
  ({available:true} | {available:false, reason}). 6 security ids:
  security_authentication, security_authorization, security_input_validation,
  security_sql_injection (available); security_mitm, security_dos
  (UNAVAILABLE — no agreed/configured scenario exists; per customer instruction
  none invented; always disabled+unchecked+reason in UI, rejected in API,
  reported "not tested" with reason).
- Execution stays LLM-browser-agent driven (prompt focus guidance per check) with
  deterministic enrichment (browserFormAudit). SQLi judged from browser-observable
  evidence only; absence of evidence ≠ safe.
- Intrusive-check authorization: `securityAuthorization.confirmed` required at
  POST /api/sessions whenever security_* selected (server-enforced 400; UI gate
  cannot bypass). browserPolicy origin pinning/private-network/destructive
  confirmations get NO exemptions for security checks. Stop control = existing
  abort path, verified not rebuilt.
- "Not tested with reason" rides existing not_covered[] + todo skip-notes; NO new
  finding status. Unexecuted checks never passed; console errors alone never a
  security verdict.
- Validation fixtures: extend server/demoSite.js (/demo, Express router) with
  known-safe + intentionally-vulnerable variants per check. Private-host
  allowlist (QASE_BROWSER_ALLOWED_PRIVATE_HOSTS) needed for local runs —
  see memory meeting-private-host-allowlist.md.
- Per-turn security payload cap planned (QASE_SECURITY_PAYLOAD_LIMIT) to keep
  input-validation/SQLi probing bounded.
- Researcher evidence (paths/lines) recorded in the hand-off: catalog at
  server/qaTestCatalog.data.js (flat, 8 tests), selection validation
  server/appQaSelection.js, UI public/app.js qaTestOption/paintQaTestCatalog
  (~3090-3130), findings shape server/qaTools.js, stop path app.js:904 →
  localServices.js:102, policy server/browserPolicy.js.
