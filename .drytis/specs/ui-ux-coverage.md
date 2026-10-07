# UI & User Experience Coverage Category

Branch: MANOJ. Goal: a hierarchical "UI & User Experience" category in the New QA Run
coverage selection, with five sub-tests; parent/child checkbox behavior with
indeterminate state; selected coverage genuinely controlling the agent's tests (kickoff
contract); selected coverage visible in the QA report. Reuse everything from the
Supported Coverage work.

## Reconciliation with existing options (critical)
The 5 requested sub-tests overlap the existing flat list:
- Desktop layout & responsive behaviour → EXISTS (desktop-layout)
- Mobile layout → EXISTS (mobile-layout)
- Browser compatibility → EXISTS as engine checkboxes (#qa-engine-options) — engines
  select which browsers run; coverage-side duplication would be confusing.
- UI consistency → NEW (no agent instruction today)
- Content & text validation → NEW

Design: restructure the panel into grouped categories instead of a flat list:
- UI & User Experience (parent) → children: Desktop layout & responsive behaviour
  (desktop-layout), Mobile layout (mobile-layout), UI consistency (ui-consistency NEW),
  Content & text validation (content-validation NEW), Browser compatibility — bound to
  the existing ENGINE checkboxes, not a duplicate coverage checkbox.
- Existing remaining options stay as their own group(s): Functional Testing (forms),
  Console & Network Health (console-errors), Navigation & Links (navigation),
  Accessibility Testing (accessibility), Security Testing (security) — rendered under a
  plain "Other supported coverage" group without a parent toggle.
Global Select All / Deselect All buttons keep working across all groups + engines.

## Kickoff contract (control is real, not visual)
- QA_SCOPE_OPTIONS gains ui-consistency + content-validation with agent instruction
  labels (e.g. "UI consistency: buttons, typography, colors, spacing, forms, cards,
  navigation rendered consistently across pages"; "content validation: text, labels,
  headings, messages and placeholders correct, readable, properly presented").
- buildQaKickoffMessage semantics unchanged: all-selected → full sweep; subset →
  "focusing on:" list. Full-sweep comparison must use the NEW total (update
  public/qaLauncher.test.js hard-coded 7-value array).
- Engines stay separate (multi-engine cross-browser runs unchanged).

## Persistence + report (selected coverage identifiable)
- Persist the user's selected coverage on the session: server parses nothing from
  prose. Preferred: client sends scopeValues with the session-create call OR the
  message route; server stores session.scopeSelection (array of values) — local store
  whitelist + Postgres migration 021 scope_selection jsonb + runRepository INSERT/
  hydrate.
- Report display: "WHAT WAS TESTED — selected coverage" block listing selected options
  (✓) and unselected (✗) under UI & User Experience + others, rendered in:
  UI renderReport (before Covered), report.md buildReportMarkdown, PDF buildQaBody.
  Agent-executed covered/not_covered lists remain adjacent, clearly labeled as
  "executed" vs "selected".
- Older runs without scopeSelection render no block (graceful).

## Phases
1. Frontend: grouped coverage UI with UI & UX parent/child + indeterminate; engine
   binding for Browser compatibility; new scope values in kickoff contract; tests.
2. Server: persist scopeSelection (local + migration 021 + repo) via session create;
   report blocks in UI/.md/PDF; tests.
3. E2E matrix + publish to MANOJ.

## Testing matrix highlights
- Parent select/deselect cascades; child partial → indeterminate parent; individual
  child independence; engines follow Browser compatibility binding (checked engines =
  browsers tested); kickoff text for: only desktop+browser compat, only new sub-tests,
  full sweep; zero coverage still blocked; existing options unaffected; report shows
  selected vs executed; refresh mid-config not applicable (no persistence today —
  dialog defaults all-selected on open, keep); console clean; responsive; keyboard nav.
