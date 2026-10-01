# Phase 4 — Security check execution, evidence & reporting

Goal: implement the four available checks as focused agent capabilities with
deterministic enrichment where possible, structured results (passed / failed / not
tested with reason), evidence, severity, safe reproduction steps, and suggested fixes.
Console errors alone are never a security result; unexecuted checks are never passed.

## Execution (server/prompt.js focus guidance + qaTools)
- `buildQaTestSelectionContext` gains a security section: per-check method, payload
  menu (safe, non-destructive), expected-secure behavior, and evidence requirements.
- Checks are browser-observable only:
  - **Authentication**: login/logout flows, invalid credentials handling, session
    cookie/token lifecycle (expiry, invalidation on logout, transport flags where
    observable), session persistence across tabs.
  - **Authorization**: with two test accounts, attempt cross-user access to another
    user's protected resource (direct URL, ID tampering); expect 403/404/redirect,
    never the other user's data.
  - **Input validation**: malformed, unexpected, and boundary-value inputs on forms/
    query params; reuse `browserFormAudit.inspectFormValidation` enrichment; expect
    server-side rejection, never unhandled errors/stack traces.
  - **SQL injection**: verify inputs cannot change database-query behavior, judged
    from browser-observable evidence only (DB error text, differential responses,
    auth bypass) — with an explicit statement that absence of evidence ≠ proof of
    safety; result recorded accordingly.
- Destructive or password/account-changing payloads remain behind browserPolicy's
  `security` destructive-category confirmation — unchanged.
- MITM/DoS: NOT implemented. They never execute; the report lists them as not tested
  with their unavailable reason. No scenarios or thresholds are invented.

## Reporting
- Per-check outcome recorded as passed / failed / not tested (reason required).
- "Not tested with reason" rides the existing `not_covered[]` mechanism and todo
  skip-notes — no fake findings, no passed-by-default.
- Security failures file findings via existing `report_finding` with severity
  (critical/high/medium/low/info), evidence, safe reproduction steps, and suggested
  fix guidance per check type.
- Final report summarizes security coverage: which checks ran, verdicts, and the
  two unimplemented categories explicitly listed as not tested.

## Fixtures & validation (server/demoSite.js + tests)
- Extend `/demo` with security fixture routes: a known-safe variant and intentionally
  vulnerable variants (reflected error/behavior differences) for auth, authorization,
  input validation, and SQLi — same hand-written Express pattern, same-origin mount.
- Validation contract: each available check, run against the vulnerable fixture,
  must produce a failure finding; against the safe fixture, must pass or report not
  tested with a reason — never a false pass.

## Acceptance criteria
- [ ] Each of the four available checks produces passed / failed / not-tested-with-reason in a real run.
- [ ] Vulnerable fixture → failure finding with severity, evidence, safe repro steps, suggested fix; safe fixture → no false failure; nothing unexecuted marked passed.
- [ ] Console errors alone never yield a security verdict.
- [ ] MITM and DoS appear in the report as not tested with their unavailability reason.

## Tests
- Unit: prompt context contains security guidance only when selected; report shape
  includes security outcomes; not_covered carries reasons.
- Fixture-driven: deterministic probes (form audit, safe payload set) against safe vs
  vulnerable fixture routes assert expected verdicts.
- End-to-end (agent test with fake provider + local fixtures): selected-only
  execution — security findings appear only for selected checks.

## Edge cases
- Target with no login system: auth/authz checks → not tested with reason, not failed.
- Fixture routes must not weaken Qase's own security headers or CSP; private-host
  allowlist note applies for local runs against /demo.
