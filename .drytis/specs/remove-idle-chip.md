# Remove stale 'idle' chip from run-status row

Ticket #14019. User circled the lowercase "idle" chip in the run-status row
(progress card top row: plan counter, %, Findings button) on a completed run.

## Root cause

`public/index.html` contains TWO elements with `id="status-chip"` (invalid duplicate id):
1. Line ~148 — panel header chip (next to timer-chip / token-chip). This is the one
   `$('status-chip')` resolves to; `setStatus()` updates it correctly (shows "done ✓").
2. Line ~184 — inside `#progress-card` `.progress-top` (run-status row). **Dead markup**:
   never selected, never updated — renders its initial `idle` text permanently, even on
   done runs. This is the chip the user marked.

## Fix

Remove the dead duplicate at ~184 only. The header chip keeps full status behavior
(running / awaiting input / done / error / interrupted styling all live on it).
Nothing else in that row changes (progress-steps, progress-pct, progress-findings,
stop button, progress bar, current activity all untouched).

## Acceptance criteria

- [ ] Only ONE `id="status-chip"` element remains (the header chip)
- [ ] The run-status row no longer renders any status chip
- [ ] Running/awaiting/done/error status display still works (header chip)
- [ ] Static source test asserts single status-chip + absence in progress-top
- [ ] Full suite green
- [ ] Browser-verified on a completed run; publish to DEV

## Out of scope

The duplicate `id="stop-run"` (also appears twice) — separate concern, not marked
by the user; leave for a future ticket if desired.
