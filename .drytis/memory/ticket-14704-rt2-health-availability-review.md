# RT2 review — #14704 Environment health checks & honest availability

Outcome: PASS on all ticket acceptance criteria; 2 WARNs (SSRF surface in network probe; device board seeded at boot only, no interval re-seed). Full suite could NOT be re-run: container regressed into fork-failure (RLIMIT_NPROC 7684 vs ~7.7k tasks; node itself crashes on uv_thread_create). RT2-relevant test files verified individually and green: environmentHealth 8/8, matrixOrchestrator.rt2 2/2, deviceRuntime 22/22, deviceRuntimeUi 13/13. localBrowserRegistry.test.js shows 5 tests (not 7 as ticket claimed); 1 failed ONLY because chrome `--version` spawn hits `fork: retry: Resource temporarily unavailable` on this host (reproduced manually) — registry honestly records 'unknown (detected)' per design; environment failure, not code.

Live board verified: 38,762 entries — 37,244 AVAILABLE / 1,518 UNAVAILABLE; DDG entries UNAVAILABLE with mobile-only reason. /api/environments computes availability live per request (registry TTL 5-min refresh in index.js).

Key implementation facts for future agents:
- environmentHealth.js: probe order execution_service(trivial PASS) → browser_support (NOT_SUPPORTED short-circuits, engine never probed) → engine_launch (withTimeout 10s, branded executablePath) → network (HEAD, any HTTP = reachable) → emulation_apply → media_capability (synthetic honestly labeled). 30s TTL cache keyed env+url, `force` bypass.
- matrixOrchestrator.executeItem: health gate at L145-158 BEFORE mark RUNNING; BLOCKED → UNAVAILABLE + `Health check blocked execution: <reason>` + healthChecks array; returns before startSession.
- manager.seedBoard: SIMULATED → resolveBrowserSupport injected async; not_supported → UNAVAILABLE+reason; maximumLevel null → OFFLINE; live session (currentSessionId) never rewritten. Called ONCE at boot (app.js:596-601) — no interval re-seed.
- WARN security: network probe fetches user-controlled run.targetUrl server-side with no private-host allowlist (QASE_BROWSER_ALLOWED_PRIVATE_HOSTS not consulted) — mild SSRF status-code disclosure surface.
