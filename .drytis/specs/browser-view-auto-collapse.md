# Auto-collapse browser view on run completion

Ticket #13998. Parent request: shrink the live browser view when a run finishes so
findings/report get the space; keep it expanded while testing; manual Expand/Collapse
that is respected; restore live layout on a new run; Studio-consistent, responsive.

## Starting point (found on inspection)

Pushkar's `QASE phases 3-12` (687aed9, already on DEV via the 13955 merge) implemented
most of this already:

- `STAGE_COLLAPSE_STATUSES = {'done','error','interrupted','idle'}` collapses the viewer
  on terminal statuses; `running`/`awaiting_input` restore the live layout.
- `state.stageExpanded` is a per-session Set; manual expand survives later status syncs
  (`renderStageCollapse` consults it; only `running`/`awaiting_input` clear it).
- `#stage-toggle` button + `#stage-note` + `.stage-collapsed` grid rows exist; clicking
  the collapsed strip also expands. The frame `<img>` is never unmounted → state preserved.
- Two `.viewer` rule blocks exist (Studio-alignment duplicate at ~1778 and legacy at
  ~5792) — both updated by Manoj's Studio alignment.

## Remaining gaps (this ticket)

1. **No test coverage at all** for the collapse logic (no `server/*.test.js` references).
2. Spec-verification: confirm each requested behavior against the code, add regression
   tests so it stays true.

## Acceptance criteria

- [ ] While status is `running`/`awaiting_input`, `.stage-collapsed` is absent (R1)
- [ ] On terminal status with stage content, `.stage-collapsed` is applied and the
      results pane gets the freed grid rows (R2)
- [ ] `#stage-toggle` flips Expand/Collapse, updates `aria-expanded` (R3)
- [ ] Toggling never reloads the frame or clears session results — frame element is
      static, only CSS classes change (R4)
- [ ] Manual expansion (session id in `state.stageExpanded`) is NOT collapsed by later
      status syncs of the same run (R5)
- [ ] A new run (`running`/`awaiting_input`) clears the manual-override for that session
      and restores the live layout (R6)
- [ ] `.stage-collapsed` grid rules exist in both style blocks; toggle uses Studio `btn`
      classes, no new component system (R7)
- [ ] Unit tests (static source assertions in `server/stageCollapseUi.test.js`) pass
- [ ] Browser verification: running→completed transition, manual toggle, findings
      scrolling, new run restores layout

## Files

- `server/stageCollapseUi.test.js` (new)
- No production-code changes expected unless verification finds a gap.

## Out of scope

- SQA/Founder stage behavior changes, findings content, Studio theme work.
