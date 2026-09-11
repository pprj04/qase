# Spec: Keep container awake during active agent runs

## Problem
Agent runs are marked `interrupted` mid-run. Workspace containers auto-pause after ~10 min of inbound-traffic idle. During a run the server is busy (LLM streaming + Chromium) but receives almost no inbound HTTP, so the container is paused mid-run; on resume the process restarts and the run is marked `interrupted` (server/store.js: running/awaiting_input → interrupted on load).

## Root cause (two layers, discovered across rounds)

1. **v1 (loopback)**: keepalive self-pinged `http://127.0.0.1:<port>/healthz`. Wiring was correct but **loopback traffic does not traverse the platform edge** — the idle counter still expired and runs kept dying. Confirmed by timestamps: runs died mid-work while v1 pings should have been firing (zero `healthz` self-pings visible in surviving logs, run death at 01:06 UTC with container idle-paused until 02:00).
2. **Disk corruption (Sep 10)**: the container volume had ext4 metadata corruption (bad block/inode bitmaps, CRC failures) causing crash-looping recreation every 2–6 min, independent of idleness. Mitigated by emergency commit + push; ext4 errors absent on Sep 11 boots.

## Solution (v2)

The keepalive pings the **public site URL** while any run is active. Public HTTPS requests traverse the Drytis edge and reset the idle timer. Loopback remains a fallback for local development when `QASE_PUBLIC_URL` is unset.

### Files
- `server/keepalive.js` — interval ping loop; logs `keepalive.started` (with URL) on arm, `keepalive.ping.ok` / `keepalive.ping.failed` per tick; exposes `isPinging()`.
- `server/index.js` — builds `keepaliveUrl` from `QASE_PUBLIC_URL` (trailing-slash-safe) with loopback fallback; wraps `services.runs.setStatus`; subscribes to the global run bus; `keepalive.stop()` first on shutdown.
- `server/store.js` — patched bus.emit + `watchRunBus()` export.
- `server/localServices.js` — `events.subscribeGlobal(listener)`.
- `server/keepalive.test.js` — unit tests (arm, ping, quiet stop, failure swallow).
- Env key `QASE_PUBLIC_URL` (tag `site_url`, /workspace/.env) registered in the backend.

## Acceptance criteria
- [x] While a run is active, `keepalive.ping.ok` appears in the service log every 60 s, targeting the public URL.
- [x] Pings stop ~2 min after the last active run (quiet hysteresis) — the container may then pause normally.
- [x] Failed pings are logged (`keepalive.ping.failed`) and retried; never crash the process.
- [x] Full test suite green (437 pass / 0 fail / 6 skipped).
- [x] Live run end-to-end: run created → `keepalive.started` logged → `keepalive.ping.ok` → run finished `done` with no interruption.

## Verification history
- Sep 10 v1: loopback keepalive, unit green, loopback pings observed — but runs still died (loopback ≠ edge traffic).
- Sep 11 v2: public-URL keepalive. Live run fc9bf569 (demo login check) ran 02:06–02:07 UTC with `keepalive.started` + `keepalive.ping.ok`; run completed `done`. Container paused later at idle (expected behavior).
