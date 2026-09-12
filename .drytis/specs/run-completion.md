# Spec: Ensure agent runs always complete (ticket #10624)

## Problem
Agent runs were dying mid-flight and never resuming:
1. **Container idle pause** — during a run the server generates almost no inbound
   edge traffic, so the platform pauses the container mid-run and the process dies.
2. **Split-horizon DNS hairpin** — inside the container the public site hostname
   resolves to the cluster-internal IP (10.x), so the v2 self-ping to
   QASE_PUBLIC_URL never traversed the platform edge and could not reset the
   idle timer. Runs still died ~16–18 min in.
3. **No recovery** — `loadSessions()` marked running sessions `interrupted` and
   nothing ever resumed them; the SDK conversation state dies with the process.

## Files to change
- [x] `server/keepalive.js` — resolve the site hostname's true public A record via
  DNS-over-HTTPS (`dns.google/resolve`), then ping `https://<public-ip>/healthz`
  with `https.request({ host: ip, servername: hostname, headers: { host: hostname } })`
  so TLS validates and the edge sees a normal request. DoH answer must be type=1
  IPv4; cache 10 min, retry 30 s on failure; plain-URL fallback when offline.
- [x] `server/index.js` — isActive predicate `services.runs.listLive().some(e => e?.record?.running)`
  keeps keepalive armed during a single long model generation when the run bus is
  quiet (fixes the disarm gap).
- [x] `server/agent.js` — crash-recovery snapshots: `runtime.getSessionSnapshot()`
  persisted to `.qase/runsnapshots/<sessionId>.json` (atomic tmp+rename, ~5 s
  throttle, after tool_result AND assistant_turn_start), deleted on terminal
  statuses. Exports: `persistRunSnapshot`, `loadRunSnapshot`, `listRunSnapshots`,
  `deleteRunSnapshot`.
- [x] `server/store.js` — running→interrupted sets `interruptedFromRun: true`;
  awaiting_input gets interrupted but NOT interruptedFromRun (never auto-resumed).
- [x] `server/runResume.js` — on boot (5 s after listen, non-blocking) scan the
  snapshot index, restore into a fresh runtime via `ensureRuntime`, drive a
  recovery turn inside the session owner's actor context. Cap 3 attempts; cap
  exhaustion adds a one-time system message and deletes the snapshot. Exactly one
  resume per boot pass. All failures swallowed and logged — boot must never crash.
- [x] `server/operationalLogger.js` — expose keepalive/diagnostic log fields
  (`keepalive.ping.ok` with `ip` field, `runresume.*` events) via SAFE_FIELDS.

## Acceptance criteria
- [x] Keepalive pings the public edge IP (provable `ip` field in ping logs), HTTP 200 every 60 s during an active run.
- [x] Keepalive stays armed during a long quiet model generation (listLive-based predicate).
- [x] Runtime session snapshots persist at a throttled cadence during runs and are removed at terminal status.
- [x] Sessions actively running at process death are marked `interrupted` + `interruptedFromRun` on load; `awaiting_input` sessions are interrupted but never auto-resumed.
- [x] On boot, a resumable interrupted run is restored from its snapshot and driven by a recovery turn naming the target, forbidding repeating completed/irreversible steps, and directing it to publish the final report — inside the owner's actor context.
- [x] Auto-resume capped at 3 attempts; exhaustion adds one explanatory system message.
- [x] Corrupt/unreadable snapshots, missing runtime restore support, and snapshot-index failures are all skipped without crashing boot.
- [x] At most one run resumes per boot pass; the newest candidate wins.

## Tests
- [x] Unit: keepalive DoH resolution + fallback; runResume isResumable matrix,
  resume-in-owner-actor, skip paths (no snapshot, corrupt snapshot, no restore
  support, index failure), one-per-boot cap; operationalLogger SAFE_FIELDS.
- [x] Full suite green (458 tests).
- [x] Live verification: keepalive pinging public edge IP 147.135.78.126 (200 every 60 s);
  real run 07d674ce auto-resumed twice across restarts with attempt accounting persisted.

## Notes
- `ensureRuntime(session, runStore)` — index.js wiring relies on
  `server/localServices.js` binding agent methods with runStore + actor wrapper.
- Env: `QASE_PUBLIC_URL` (site_url tag) drives the keepalive target.
- Logs land in /var/log/services/service-bg-service-4182.log.

## Post-incident addendum (ticket #10626)
A container pause/resume cycle corrupted two files at the filesystem level
(dead inodes, "Structure needs cleaning"): `server/runResume.js` (crashed the
server on boot) and this spec file. Both entries were cleared via debugfs;
`runResume.js` was rewritten from its intact test file
(`server/runResume.test.js`, 9/9 green; full suite 452 pass / 0 fail) and this
spec was rewritten from `.drytis/memory/run-completion-architecture.md`.
Root cause to watch: ext4 block-bitmap checksum mismatch on the container volume
— flagged for infra.
