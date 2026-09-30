# Ticket #12959 — Security testing suite

## Goal
Give Qase a real, deterministic security-testing capability the agent can run
against a target site (Thomas's demo demand: "a real security testing suite —
SQLi etc."). Security findings flow through the existing `report_finding`
model, severity escalation, and report rendering unchanged.

## Design decisions
- **Security checks live in QA mode as host-driven tools**, not a fourth mode.
  QA is the "test everything" launcher; adding `security-check` steps to the
  QA kickoff checkboxes (#12956) covers discovery, and the tools are usable in
  follow-up runs. (SQA keeps its no-intrusive-payloads rule — SQA is evidence
  gathering, not active testing.)
- **Checks are host-driven and deterministic** (same philosophy as
  `whiteboxAnalysis.js`): the model invokes `security_check`, the host runs
  the check suite against the current page / target and returns structured
  results; the model then reports findings via `report_finding`. This avoids
  giving the model an arbitrary-JS tool and makes results reproducible.
- **Authorization gate**: active security checks only run against the
  configured target origin, same as the browser policy already enforces, and
  the QA kickoff scope text states the target owner is consenting to testing.

## New files
- `server/securityChecks.js` — pure check implementations + check registry:
  - `CSP`, `HSTS`, `X-Frame-Options`, `X-Content-Type-Options`,
    `Referrer-Policy` presence/quality (response headers captured at the
    `context.route` seam).
  - Cookie flags on the current page (HttpOnly/Secure/SameSite).
  - Reflected XSS probe: submit a canary payload through the page's search-like
    form(s), verify reflection escaping via host-side DOM inspection.
  - SQLi error-signature probe: submit a benign error-triggering payload
    (`'`) to form inputs and scan the response body/headers for DB error
    signatures (no time-based or destructive payloads).
  - Mixed-content / TLS check when target is https.
  - Each check: `{ id, title, category: 'security', severity, status:
    'pass'|'fail'|'info', evidence, remediation }`.
- `server/securityTools.js` — agent tool `security_check` (schema: `checks` —
  optional list of check ids, default all) wired to the bridge diagnostics +
  host probes; results also appended to bridge diagnostics
  (`securityReport`), so the UI shows them live.
- `server/securityPrompt.js` — QA prompt section: when security scope is
  selected, instruct running `security_check` after functional exploration,
  reporting each failed check via `report_finding` with category `security`
  and the check's evidence/remediation.
- `server/securitySuite.integration.test.js` — live-browser tests (gated on
  `QASE_RUN_BROWSER_TESTS=1`, same as browserMedia) against an extended demo
  site.

## Demo site extensions (`server/demoSite.js`, behind existing demo gate)
- `/demo/vuln/search?q=` — deliberately UNESCAPED reflection (positive XSS
  demo), linked from the demo nav only when `NODE_ENV !== 'production'`.
- `/demo/vuln/notes` — sqlite-free in-memory "store" with a deliberately
  injectable string-matching query whose error path leaks a fake DB error
  message (positive SQLi-signature demo; no real SQL anywhere).
- Demo login cookie stays flagless (existing) — positive cookie-flags demo.

## Wiring
- `server/agent.js`: register `security_check` in QA tool set
  (`allowedToolNames` + tool injection block), description advertised.
- `server/prompt.js`: include security guidance when scope selected.
- `public/qaKickoff.js`: add "Security (headers, XSS reflection, SQLi
  signatures)" to `QA_SCOPE_OPTIONS` (pre-checked in "test everything"
  default? — no: default checked set stays functional-first; security box
  unchecked by default until the pilot, per "test everything" = Thomas's
  demo default. DECISION: checked by default per transcript demand).
- Findings: `report_finding` unchanged; verdict escalation already maps
  critical/high → fail.

## Acceptance criteria
- [ ] `security_check` tool available in QA mode; refused in SQA/founder.
- [ ] Header + cookie-flag checks verified against demo site (positive +
      negative cases).
- [ ] XSS reflection check detects the unescaped `/demo/vuln/search` sink and
      does NOT flag the escaped `/demo/app/search`.
- [ ] SQLi signature check detects `/demo/vuln/notes` leak and passes clean
      forms.
- [ ] Findings appear with category `security`, severity, evidence,
      remediation; escalation to `fail` on critical/high works.
- [ ] Integration tests pass under `QASE_RUN_BROWSER_TESTS=1`; unit tests for
      check registry, payload builders, signature matching pass in default run.
- [ ] Security scope checkbox in QA launcher (default checked per demo
      demand), included in kickoff message.
- [ ] Full suite green; reviewer + tester PASS.

## Out of scope (this ticket)
- Multi-browser engines (Phase 8), authenticated deep scans, time-based SQLi,
  authenticated CSRF testing, external payload lists (network policy blocks
  them anyway).
