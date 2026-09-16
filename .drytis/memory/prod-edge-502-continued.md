# qase.drytis.com 502 — diagnostic trail (2026-09-15, continued)

## Progress at 18:04Z: edge IS routing now
- User's browser screenshot: https://qase.drytis.com/health → "Production Environment OK" (pod Caddy's exact string).
- In-container probes via `--resolve qase.drytis.com:443:147.135.77.206` (public edge IP): /health → 200 with cache-busted query strings (live, not cached).
- PROXIED paths still 502: /, /api/health, /readyz, /app.js — everything that reverse-proxies to the app, while pod-Caddy-answered paths (/health) work.
- External fetcher (Tavily) sees a Drytis "starting your container / waiting for your app to respond" interstitial on /.

## Two REAL bugs found and fixed on the pod
1. **Boot-time .env truncation (platform bug):** after EVERY full container restart (restart_production / redeploy), /workspace/.env on the prod pod is TRUNCATED TO 0 BYTES. Symptom: app banner "No API key set", practice target prints 127.0.0.1, and (critically) the app binds 127.0.0.1:5173 instead of 0.0.0.0 → every app-proxied path 502s because the gateway can't reach a loopback-bound app. Reproduced twice (18:05 and 18:18 restarts). Fix per occurrence: `update_production_config` (writes the 355-byte .env) + `procmgr restart service-bg-service-4182` (NOT a container restart). **Until the platform fixes materialization, every container restart must be followed by config-push + app-service restart.**
2. **Missing QASE_PUBLIC_URL → app printed 127.0.0.1 in banner.** After .env restore, banner shows 0.0.0.0:5173 — binding correct.

## Decisive evidence the 502 is a STALE EDGE ARTIFACT, not the app
- The 502 response served for / carries `etag: "dhgge9dh6874sf"`, `last-modified: Mon, 30 Mar 2026 22:00:58 GMT`, `accept-ranges: bytes`, `content-length: 1023`, double `server: Caddy` header — a STATIC cached page, not a live upstream error.
- My 18:25Z request to https://qase.drytis.com/ ARRIVED at the pod (app log: GET route "unmatched" 200 at the matching timestamp) — upstream answered 200, client still got the static 502.
- /health responds live through the same edge → the route exists; only the cached-failure path persists for app-proxied URLs.

## Also tried (did not change the cached 502)
- Patched the pod's :80 catch-all Caddyfile block to proxy / → 127.0.0.1:5173 (theory: gateway readiness probes the platform hostname and got 404). Backup at /tmp/Caddyfile.bak on the pod. The platform hostname now serves the app at / (200). No effect on the custom domain's cached 502. **NOTE: this Caddyfile patch is live on the pod but will be overwritten by the next config tar; decide whether to keep it (it makes the platform hostname serve the app, which seems desirable).**

## State of record for platform support
- Deployment #153, pod healthy at commit 1be3796, .env restored, app bound 0.0.0.0:5173, pod Caddy 200s for Host qase.drytis.com on /, /api/health (401 auth-gated — correct), /readyz 200.
- Edge: /health live 200; / and app-proxied paths → static cached 502 page (etag dhgge9dh6874sf); external interstitial "waiting for your app".
- Needed from platform: (1) fix .env truncation-on-boot for deployment #153; (2) purge the stale cached 502/interstitial for qase.drytis.com at the edge; (3) custom_domains API row still missing.

## Related tickets
#10964 — this investigation. #10927, #10848 — earlier domain work.