# E2E security run findings (2026-09-29, tickets #13671–13673 aftermath)

Two blocking UI bugs found while starting security-only runs + an environment blocker:

## Bug 1 (regression): Standard category toggle is dead
`public/app.js` qaUi object (line ~3049) defines `securityCategoryToggle` but NEVER assigns
`standardCategoryToggle`. Both `syncQaCategoryToggles` (:3100) and the toggle click loop (:3243)
reference `qaUi.standardCategoryToggle` → undefined → silently skipped (`if (!toggle) continue`).
Clicking #qa-category-standard-toggle does nothing: no uncheck of the 8 standard boxes, no tri-state.
Tester had verified this working in the #13672 round — likely lost in a later refactor. Workaround:
uncheck standard boxes individually.

## Bug 2 (critical happy-path): confirmed authorization still blocked by stale setCustomValidity
`syncQaSecurityGate` (app.js:3198–3211) sets `setCustomValidity('Confirm the target…')` whenever any
security check is selected, but checking the confirmation checkbox NEVER calls `setCustomValidity('')`.
So with confirmation checked, reportValidity() still fails → form blocked forever with the "Confirm…"
error even though the box is checked. Both e2e runs could only start after manually calling
`auth.setCustomValidity('')` via devtools. The only place validity is cleared is when NO security check
is selected (:3205). Fix needs: clear custom validity when checkbox is checked (e.g. on change).

## Environment blocker: agent cannot test its own preview host
The agent's browser-safety policy (browserPolicy.js private-network guard, intentionally untouched per
#13673 review) blocks qase-2-1-jywqe4.drytis.dev — host resolves to private/reserved network space.
BROWSER_PRIVATE_NETWORK_BLOCKED on every open. So /demo/security/vulnerable and /demo/security/safe
fixtures are unreachable from runs started in the preview environment. Both runs ended "Blocked",
0 findings, all four security checks honestly not-tested-with-reason. To e2e-test the fixtures, they
must be exposed on a public-resolving host (or the origin allowlisted in the environment).

## Good behavior observed despite blockers
- POST /api/sessions payload correct: selectedTests = 4 security ids, securityAuthorization {confirmed:true}.
- Agent asked a structured decision question instead of fabricating results; "End run as blocked" path
  produced a clean Blocked report (0 findings, per-check not-covered reasons, no false passes).
- Report schema validation even rejected the agent's first report attempt that included MITM/DoS entries
  not in the run's selection (agent corrected itself).
