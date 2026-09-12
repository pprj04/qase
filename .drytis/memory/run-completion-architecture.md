# Run completion architecture (ticket #10624)

## Root causes of interrupted runs
1. **Container idle pause**: during a run the server generates almost no inbound
   edge traffic → platform pauses the container mid-run → process dies.
2. **Split-horizon DNS hairpin (v2 keepalive bug)**: inside the container, the
   public site hostname resolves to the cluster-internal IP (10.x), so a
   self-ping to QASE_PUBLIC_URL never traverses the platform edge and cannot
   reset the idle timer. Runs still died ~16–18 min in.
3. No recovery: `loadSessions()` marked running sessions `interrupted` and
   nothing ever resumed them; the SDK conversation state dies with the process.

## Fixes
- **server/keepalive.js**: resolves the site hostname's true public A record via
  DNS-over-HTTPS (`dns.google/resolve`), then pings `https://<public-ip>/healthz`
  with `https.request({ host: ip, servername: hostname, headers: { host: hostname } })`
  so TLS validates and the edge sees a normal request. DoH answer must be
  type=1 IPv4; cached 10 min, retry 30 s on failure; plain-URL fallback offline.
- **isActive predicate** (index.js): `services.runs.listLive().some(e => e?.record?.running)`
  keeps keepalive armed during a single long model generation when the run bus
  is quiet — this fixed the disarm gap that still let runs die.
- **Crash snapshots** (agent.js): runtime.getSessionSnapshot() persisted to
  `.qase/runsnapshots/<sessionId>.json` (atomic tmp+rename, ~5s throttle, after
  tool_result AND assistant_turn_start), deleted on terminal statuses.
- **store.js**: running→interrupted sets `interruptedFromRun=true`;
  awaiting_input gets interrupted but NOT interruptedFromRun (never auto-resumed).
- **runResume.js**: on boot (5 s after listen, non-blocking) scans the snapshot
  index, restores into a fresh runtime via ensureRuntime (which caches the
  record so runTurn reuses the restored runtime), drives a recovery turn inside
  the session owner's actor context. Cap 3 attempts; cap exhaustion logs
  `runresume.exhausted`, adds one-time system message (resumeExhaustedNotified),
  deletes the snapshot. One resume per boot pass.
- Logs: `runresume.resumed/skipped/exhausted/scan.*` and `keepalive.ping.ok`
  (with `ip` field proving edge traversal) in /var/log/services/service-bg-service-4182.log.

## Verified live
- Keepalive pinging public edge IP 147.135.78.126, 200 every 60 s.
- Real run 07d674ce auto-resumed twice across restarts (runresume.resumed
  attempts 1 and 2 in logs), attempt accounting persisted.

## Notes
- ensureRuntime(session, runStore) — index.js wiring relies on
  server/localServices.js binding agent methods with runStore + actor wrapper.
- Node server: port 5173, Caddy reverse proxy at /, procmgr service
  `service-bg-service-4182`, command `cd /workspace && exec node server/index.js`.
- Tests: 458 total; keepalive DoH fallback, runResume resume/skip/cap,
  logger SAFE_FIELDS all covered.