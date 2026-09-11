# Drytis Integration UX Specification

Status: future-mode specification only
Baseline: `f15183bf321c683a4585298f0e415e240747f25a`

## 1. Objective

The standalone QASE frontend must be reusable inside Drytis Studio without building a second UI or asking a Drytis user to paste the current project's preview URL. Embedded mode changes context and chrome, not QASE execution semantics.

This document does not define or authorize a new integration API. Existing HMAC routes, human cookie sessions, bearer flows, workspace authorization, and owner isolation remain separate and unchanged.

## 2. One frontend, two presentation modes

Use the same HTML, ES modules, components, status mappers, evidence viewers, and action handlers in both modes.

- Standalone mode: full QASE sidebar, project selector, account menu, product settings, and manual New Run fields.
- Embedded mode: compact contextual shell supplied by Drytis, with project identity and preview context prefilled. Hide only redundant chrome; do not fork page implementations.

Mode should be determined from an authenticated, validated host context—not from an arbitrary query parameter that could spoof identity or workspace.

## 3. Required host context

Drytis Studio should eventually provide a signed or server-resolved context containing:

| Field | Purpose | UI behavior |
| --- | --- | --- |
| User identity | Attribution and permission display | Show current identity; never trust display fields for authorization. |
| Workspace identity | HMAC/integration scope | Bind server-side; never allow client overrides. |
| Project ID | QASE project selection | Select/lock context when authorized. |
| Project name | Human-readable shell context | Display only. |
| Preview URL | Target of a new run | Prefill and normally lock; user should not paste it. |
| Requirements/context | Testing instructions and app ground truth | Prefill “What should QASE test?” or advanced context with clear source labeling. |

Optional context may include route, selected run/finding, requested focus, and return destination. These are navigation hints, not authorization grants.

## 4. Trust and authentication boundaries

- Human browser sessions continue to use the existing HttpOnly cookie flow.
- Machine bearer authentication remains for its intended machine clients.
- Drytis integration requests continue to use the existing HMAC identity/workspace model.
- Embedded UI context must be exchanged for or resolved against a server-recognized principal before protected QASE data is loaded.
- Client-provided `userId`, `workspaceId`, `projectId`, owner fields, role, preview URL, or return URL must be validated and scoped server-side.
- Embedding must not relax frame, origin, CSRF, cookie, or content security policy without a reviewed threat model.
- No HMAC secret, bearer token, session token, password, or provider credential may be passed through URL parameters, DOM-visible bootstrap JSON, analytics, or console logs.

## 5. Embedded shell

Header:

- QASE label and compact execution state.
- Drytis project name and preview host.
- Return-to-Drytis action using a server-approved destination.
- Account identity accessible on desktop and mobile.

Navigation:

- Keep the same QASE destinations and route components.
- Allow the host to open a focused run, finding, or report view.
- Collapse the main QASE sidebar by default where Studio already supplies primary navigation.
- Never remove Sign out/account access solely because QASE is embedded; behavior may instead be coordinated with the host's authenticated session policy.

New Run:

- Prefill target from the authorized preview URL.
- Prefill project requirements/context and label them “From Drytis project.”
- Keep the test request editable unless host policy makes it fixed.
- Do not show a manual target field by default. Provide a read-only host with an explicit “Change target” affordance only if the authorization model supports other targets.
- Use the same mission creation action and certified outcome handling as standalone mode.

Run, Finding, and Report views:

- Reuse the standalone components without data-shape adapters that alter meaning.
- Preserve canonical outcomes, finding counts, report availability, evidence permissions, and Authentication Required state.
- “Send to Coding Agent” remains absent until an authorized, auditable server action exists. A future action must show exactly what finding/context will be sent and to which Drytis project.

## 6. Context lifecycle

1. Studio opens QASE with a short-lived opaque handoff reference or an authenticated server-to-server flow.
2. QASE resolves the reference server-side and validates user, workspace, project, and preview access.
3. QASE returns a minimal safe UI context and continues using its normal protected APIs.
4. Project/context changes in Studio produce a new validated context; stale QASE requests are cancelled and old content is cleared before the new project renders.
5. On expiry or revocation, QASE shows a focused reconnect/return state rather than falling back to a different project.

Do not place the full context or secrets in localStorage. Standalone preferences such as theme may remain local; authoritative embedded project identity does not.

## 7. Reusable component boundaries

The redesign should isolate these reusable view modules:

- App shell and context header.
- Project context presenter/selector.
- New Run form with injectable target/context defaults.
- Canonical run status and execution health.
- Browser/evidence viewer.
- Activity/analysis/findings/report tabs.
- Finding list/detail.
- Report summary/detail.
- Authentication Required card.
- Shared loading, empty, unavailable, and error states.

Each receives normalized UI state and calls the same shared API helper. Standalone and embedded bootstraps supply context; they do not copy page markup.

## 8. Responsive behavior

- Embedded desktop: compact header; host and QASE chrome must not create two permanent navigation columns around a narrow browser preview.
- Embedded tablet: QASE details become a drawer or lower panel; project context stays visible.
- Embedded mobile: single-column run view, host-aware back action, accessible account/session controls, and no hover-only interaction.
- Frame height changes must use container-relative layout rather than fixed `100vh`, which is unreliable inside an embedding surface.

## 9. Accessibility and failure states

- Focus enters QASE at the page heading, not inside a live log.
- Host-context updates are announced politely and never steal focus during an active credential form.
- Expired handoff, forbidden project, unavailable preview, and disconnected host are distinct states.
- Live frames have a textual state and persisted-evidence alternative.
- Embedded messages use `postMessage` only with exact origin checks and validated schemas.

## 10. Backend gaps requiring separate approval

- Secure embedded-context exchange/resolution endpoint and expiry model.
- Explicit allowed-origin/frame policy.
- Optional structured host-to-QASE navigation protocol.
- Optional authorized “Send to Coding Agent” endpoint and audit trail.
- Structured Authentication Required challenge metadata if exact destination/fields are needed.

These gaps must not be approximated with client-trusted query parameters. Until they exist, implement and certify the standalone redesign only.

## 11. Embedded acceptance criteria

- One source tree and one set of page components serve both modes.
- Authorized Drytis project opens with project ID/name and preview URL already resolved.
- No target URL copy/paste is required for the current project.
- A run created in embedded mode uses the same mission/session API and canonical outcomes as standalone.
- User/workspace/project isolation is enforced server-side.
- No secret or privileged identity field appears in the URL, logs, findings, reports, or browser storage.
- Changing project cannot display stale data from the previous project.
- Account, navigation, settings permissions, and sign-out remain reachable at all supported widths.
