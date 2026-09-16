# qase.drytis.com 502 — diagnostic trail (2026-09-15, FINAL root cause)

## TL;DR
The 502 page is served BY THE EDGE GATEWAY'S OWN CADDY as a static file. Every custom-domain route row is missing (`custom_domains` = []), and the gateway responds 502.html for any path that would need to proxy to a pod. `/health` only works because that string comes from the FIRST pod Caddy hop... no — see below, corrected by evidence:

## Corrected model (18:25–18:40Z evidence)
- The 502 body received by clients is **byte-identical (md5 65b7ea85c3deefcc2dc2d51e6e232ca4) to /usr/share/caddy/502.html shipped in the Drytis base image** — the SAME image runs on the gateway hop and on prod pods. The response carries `etag: "dhgge9dh6874sf"`, `last-modified: Mon, 30 Mar 2026 22:00:58 GMT`, `accept-ranges: bytes`, DOUBLE `Server: Caddy` (two Caddy hops: gateway + something), content-length 1023. It is a static file serve, not a live error.
- Fresh cache-busted GETs over HTTP and HTTPS (direct to cluster edge IP with Host header) both return this static 502 → not a cache: it is the gateway's CURRENT behavior for unrouted/failed-proxy paths.
- `/health` returns "Production Environment OK" (200, live, cache-busted). This string exists ONLY in the prod pod's Caddyfile (`http://qase.drytis.com { handle /health { respond "Production Environment OK" 200 } }`). So SOME route from the public edge to the pod exists and /health flows through it. Explanation that fits all evidence: the gateway proxies to the pod for this hostname but the POD Caddy answers /health locally (no app hop needed) while every OTHER path requires the pod Caddy→app hop... BUT pod-side tests show pod Caddy → app works (200/401). Remaining consistent explanation: the gateway→pod hop for app-proxied paths goes to a listener/binding that is not our current pod or drops the Host header so the pod's named-site block doesn't match (falls into catch-all 404 or TLS-mismatch on :443). Could NOT fully pin which.
- What is certain: app healthy (logs show edge requests arriving and answered 200), pod Caddy correct, DNS correct, edge TLS correct, /health routed. The gateway's proxy for the remaining paths targets something that yields its static 502.html.
- `list_production_custom_domains` STILL returns [] — the registration record never existed; routing that works (/health) must come from another mechanism (tls-edge fallback or wildcard).

## Platform actions requested (ticket #10964)
1. Register qase.drytis.com → deployment #153 at the gateway/tls-edge (custom_domains row missing is THE defect).
2. Fix boot-time .env truncation on prod container restarts (documented in prod-edge-502-continued.md).
3. Purge/refresh any gateway-side static-error state for the hostname.

## Notable tools/paths
- 502 static file: /usr/share/caddy/502.html (in prod pod; presumably same file at the gateway since same base image).
- Pod Caddyfile: /etc/caddy/Caddyfile (patched :80 catch-all to proxy / → 127.0.0.1:5173; original at /tmp/Caddyfile.bak).
- App logs: /var/log/services/service-bg-service-4182.log (requestId lines prove edge→app flow for the requests that DO arrive).