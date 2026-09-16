# qase.drytis.com 502 — root cause found (2026-09-15 ~18:35Z, supersedes "stale cache" theory)

## DECISIVE EXPERIMENT
Made pod-Caddy's /health respond with a unique marker ("Production Environment OK pod153-live"). Edge /health for qase.drytis.com returned the UNMARKED "Production Environment OK" (also with cache buster). → **The edge is NOT proxying qase.drytis.com to deployment #153's pod.**

A second timestamped probe confirmed: edge request at 18:29:49 with unique query string NEVER appeared in the app log (last entry 18:23:48). My earlier 18:25 correlation was a false match.

## What actually serves qase.drytis.com at the edge
- A PLATFORM component (the Drytis "starting your container / waiting for your app to respond" interstitial service). External fetchers (Tavily) see that interstitial HTML on /.
- Its /health answers a generic "Production Environment OK" template (indistinguishable from a pod Caddy health block by text — that's why the user's 18:04 screenshot looked like success; it was the platform's template, NOT our pod).
- Its / and everything else: 502 (or the interstitial) — it waits for a hostname→deployment mapping that does not exist: `list_production_custom_domains` → [].
- The 502 page served for / has etag "dhgge9dh6874sf", last-modified Mar 30 2026 — a static file of the platform component.

## Working theory of the sequence
1. Incumbent (project 2516, deployment #129 or similar) held the edge route.
2. When it stopped (~14:00–15:49Z), the route row vanished (custom_domains []).
3. Since then: every deploy flow we trigger fails to WRITE the route row. deploy_to_production #153 registered DNS/TLS (cert still valid) but the hostname→service mapping never materialized, so the edge falls back to its interstitial/502 static handler.

## Pod-side state (all verified good — nothing to do there)
- #153 @ 1be3796, .env restored (355 B), app bound 0.0.0.0:5173, /api/health → 401 auth-gated, /readyz → 200.
- Pod Caddy canonical Caddyfile restored (unmarked health string). KEPT IMPROVEMENT: the :80 catch-all now proxies / → 127.0.0.1:5173 so the platform hostname (prod-qase-2-1-tawpkk.drytis.dev) serves the app at root (200) instead of 404 — useful for the gateway's readiness probing and for a usable direct URL.
- NOTE: this Caddyfile edit lives only on the pod; the next config-tar push OVERWRITES it. Fold the catch-all / proxy into the backend Caddy template if it should persist (infra change → reclassify major, re-run gate).

## Platform items needed (from support)
1. Write the custom-domain route row for qase.drytis.com → deployment #153 (custom_domains API returns [] today).
2. Fix boot-time /workspace/.env truncation to 0 bytes on container restart (reproduced 18:05 and 18:18; workaround = update_production_config + procmgr restart service-bg-service-4182 — do NOT full-restart the container without redoing this).

## Related tickets
#10964 (In Progress) — evidence trail. #10927, #10848 earlier.