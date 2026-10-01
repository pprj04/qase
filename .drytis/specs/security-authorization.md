# Phase 3 — Authorization gate & run configuration

Goal: intrusive security checks run only against explicitly authorized, isolated test
environments, with defined scope, limits, and timeouts — reusing browserPolicy and the
existing Stop control. Selecting a checkbox or "Select all" must never bypass this.

## Authorization gate
- Session creation requires `securityAuthorization.confirmed === true` whenever any
  `security_*` test is selected (validated in Phase 1; UI wiring here).
- Dialog UI: when any security checkbox is checked, an inline confirmation block
  appears (required before Start test enables): "The target is an explicitly
  authorized, isolated test environment" + optional scope notes field. Unchecking all
  security tests hides it and clears the requirement.
- The confirmation is sent with `POST /api/sessions` and persisted; the agent context
  records that security testing was authorized and within what scope.

## Scope & limits (reuse, do not rebuild)
- Target-origin pinning, private-network guard, and destructive-action confirmations
  stay enforced by `server/browserPolicy.js` — security checks get no exemptions.
- Security payload probes stay subject to: probe timeout (12s), 1MB response cap,
  Playwright per-action timeouts, `QASE_MAX_TURNS`, and the abort-signal path.
- Add a hard per-turn security-payload cap (config, e.g. `QASE_SECURITY_PAYLOAD_LIMIT`,
  default modest) so input-validation/SQLi probing cannot become a flood.

## Stop control
- Existing `POST /api/sessions/:id/stop` → AbortController must abort mid-security-
  check, same as any QA turn. Verify (not rebuild): a stopped run during a security
  probe ends `idle` with "Stopped by user." and never marks the check passed.

## Acceptance criteria
- [ ] Selecting security tests without confirming authorization cannot start a run (UI disables/blocks; server 400s regardless of client).
- [ ] "Select all" including security checks does not bypass the confirmation gate.
- [ ] An authorized security run is constrained to the declared target origin and existing policy walls (no new exemptions).
- [ ] Stopping mid-security-check halts the run cleanly; no unexecuted check is reported passed.

## Tests
- Unit/integration: authorization matrix (confirmed/unconfirmed × security/standard),
  Stop during a security turn (agent test with fake provider), payload cap enforcement.
- Browser: gate visibility toggling with security selection; blocked submit without
  confirmation.

## Edge cases
- Authorization confirmation persisted but security tests later deselected →
  confirmation inert, not re-prompted.
- Distributed/remote run mode (`queue.cancelRun`) path unchanged.
