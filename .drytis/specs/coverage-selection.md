# Simplified Coverage Selection

Branch: MANOJ. Goal: replace the technical scope list in the QA launcher with a clear
"Supported Coverage" section using EXISTING coverage definitions; keep Founder Mode and
Compliance as independent optional choices; no backend/API changes.

## Current state (research)
- Scope options: `public/qaKickoff.js:7-15` — QA_SCOPE_OPTIONS, 7 items, `{value,label}`;
  label is the literal instruction text the agent receives.
- `buildQaKickoffMessage(values)` (qaKickoff.js:25-32): all-or-none → null (full sweep);
  subset → "Test this website, focusing on: …".
- UI: `public/index.html:510-528` fieldset #qa-scope-options (all checked), select-all
  #qa-scope-all; wiring `public/app.js:4013-4030`, values read at 3866-3871; empty
  selection already blocked at 4051-4054.
- Flow: selections → kickoffText → POST /api/sessions/:id/message text (structured scope
  does NOT exist server-side; agent consumes the message). Preserve exactly.
- Cross-Browser: engine checkboxes index.html:501-509 + multi-engine runs app.js:4056-4066.
- Founder: dialog #founder-start (index.html:681-758), POST /api/founder/sessions.
- SQA (compliance capability): dialog #sqa-start, POST /api/sqa/sessions.
- No persistence of scope selections (form.reset() on open) — keep that behavior; defaults
  = all checked, restored on every dialog open and page refresh.

## Category mapping (existing definitions only — nothing invented)
| Friendly label (UI) | Existing scope value |
|---|---|
| Web Application Testing | desktop-layout |
| Mobile Testing | mobile-layout |
| Functional Testing (forms & validation) | forms |
| Console & Network Health | console-errors |
| Navigation & Links | navigation |
| Accessibility Testing | accessibility |
| Security Testing | security |
| Cross-Browser Testing | existing engine checkboxes (kept beside coverage) |

Excluded — no existing support, must NOT be offered as coverage: API Testing,
Regression Testing, Performance Testing. qaKickoff.js keeps the instruction labels
(agent contract); friendly names live in the UI layer only.

## Phase 1 — Supported Coverage section (frontend only)
Files: public/index.html, public/qaKickoff.js, public/app.js, public/styles.css,
public/qaLauncher.test.js.
- Restructure #qa-scope-options into "Coverage Selection / Supported Coverage" panel with
  heading + [Select All] [Deselect All] buttons (both must exist; Select All already does).
- All 7 checkboxes preselected (existing default); Deselect All unchecks every option.
- Individual toggle changes only that option (no resets of siblings/engines).
- Friendly labels above; title/tooltip can carry the technical description.
- Validation preserved: submitting with zero coverage shows a clear inline error; nothing
  silently reselected. Selecting zero via Deselect All then Select All restores all.
- buildQaKickoffMessage semantics, values, and submitted kickoffText UNCHANGED.
- Responsive (mobile grid), Studio design tokens.

## Phase 2 — Optional Choices (Founder Mode, Compliance)
- New "Optional Choices" block in the QA dialog below coverage: ☐ Founder Mode,
  ☐ Compliance (SQA) — unchecked by default, independent of coverage state.
- On submit with a box checked: QA run starts normally with selected coverage, then the
  existing Founder/SQA dialog opens prefilled with the same target URL for the user to
  confirm. No auto-created founder/sqa sessions; no new backend flags.
- Toggling either box never touches coverage checkboxes or engine selections.

## Phase 3 — QA verification + publish to MANOJ
- Full test matrix from the task: preselection, Select/Deselect All, individual
  selection isolation, restore, zero-coverage submission blocked with message,
  submission payload contains exactly the selected coverage, Founder/Compliance
  independence and combinations, engine interplay, console clean, no API/state errors.
- Suite green; publish to origin/MANOJ.
