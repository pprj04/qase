# Spec: Keep container awake during active agent runs

## Problem
Workspace containers auto-pause after ~10 min of inbound-traffic idle and resume on the next request. During an agent run the server is busy (LLM streaming + Chromium) but receives almost no inbound HTTP, so the container is paused mid-run; on resume the process restarts and the run is marked `interrupted` (server/store.js: running/awaiting_input → interrupted on load).

## Fix (server-side self-keepalive)
While at least one session is active (status `running` or `awaiting_input`), the server issues a self-loopback GET to its own `/healthz` every 60 s. This counts as inbound traffic and keeps the container awake. It must:

- Start automatically when a run starts; stop ~2 min after the last active run ends (hysteresis so back-to-back runs don't gap).
- Never throw or produce unhandled rejections (log at debug/warn, swallow).
- Be cleaned up in shutdown drain handlers (no dangling timer).
- Not run when no session has ever been active (idle server = no extra traffic).

## Files
- server/index.js — instantiate and wire into run lifecycle + shutdown steps.
- server/keepalive.js (new) — small module: `createRunKeepalive({ getUrl, intervalMs, fetchImpl, logger })` returning `{ noteActive(), stop() }`.
- server/keepalive.test.js (new) — unit tests.

## Acceptance criteria
- [ ] Keepalive loop only ticks while runs are active (or within hysteresis window)
- [ ] Self-request targets /healthz on the configured host/port
- [ ] Fetch errors are swallowed (no unhandled rejection, no crash)
- [ ] stop() clears the interval; wired into shutdown handlers
- [ ] Unit tests + full `npm test` green
- [ ] Manual check: run started → periodic healthz entries in server log
