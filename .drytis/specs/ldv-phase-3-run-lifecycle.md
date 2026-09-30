# LDV Phase 3 · Run lifecycle states, completion persistence, error states, log targeting

## Goal
The live view tells the truth across the whole run lifecycle and never resets to "No browser yet / about:blank" the moment a run completes.

## Runtime status states
Surface the Phase-1 vocabulary on the live badge with distinct visuals: QUEUED · RESERVING DEVICE (queued→starting) · CONNECTING… (created) · CONNECTED · RUNNING · COMPLETED · FAILED · DEVICE UNAVAILABLE. Map `session.status` + device-runtime session status + board availability (NOT_EXECUTABLE/OFFLINE → device_unavailable).

## Completion persistence (AC8)
In `applySessionSnapshot`, when status is done/error and a last frame exists, KEEP the final frame + environment rendered (badge switches to COMPLETED with exec badge). Only show "No browser yet" when there is genuinely no frame and no run. Do not reset url to about:blank on completion.

## Error state (AC10)
When runtime cannot verify/provide the device: show DEVICE/BROWSER UNAVAILABLE panel state — env summary (device · OS · browser), Reason (from status detail / availability), [Retry] (re-run same env) + [Change Environment] (opens Device Matrix) actions. Never render a fake browser preview in this state; never show REAL DEVICE.

## Execution log targeting
In the run log stream: on run start emit/render a TARGET block (device · OS · browser · EXECUTION level · RUNTIME id — from view-model), "TEST STARTED"; during execution a TESTING line "device · browser version" pinned with the live status; at completion "TEST COMPLETED — device · OS · browser — Result: PASS/FAIL/BLOCKED". Rendered client-side from the session/view-model at the existing status/message render points (no backend change).

## Files
- `public/app.js` (applySessionSnapshot persistence logic, error panel state, log blocks)
- `public/styles.css` (state badge variants, unavailable panel, log target block)
- `public/index.html` (unavailable-state markup hidden by default)

## Acceptance criteria (running app)
- [ ] All eight states visibly distinct during a run, in order.
- [ ] Completed run keeps final frame + full environment info until a new run starts.
- [ ] Unavailable runtime shows the unavailable panel with working Retry/Change actions, no fake preview, no REAL DEVICE.
- [ ] Log shows TARGET/TESTING/COMPLETED blocks with the exact active environment and result.

## Tests
- Extend view-model tests for status ordering + unavailable mapping; app logic for keep-last-frame on completion (no regression to about:blank).
- Existing suite green.
