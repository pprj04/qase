# qase.drytis.com 502 — diagnostic trail (2026-09-15)

## Symptom
https://qase.drytis.com → 502 Bad Gateway (edge-branded page, md5 65b7ea85c3deefcc2dc2d51e6e232ca4), HTTP and HTTPS alike.

## Verified WORKING (project side is fine)
- Deployment #152: status=running, health=healthy, admin_email=mishmuneer2011@gmail.com, domains=[qase.drytis.com]
- App in pod: localhost:5173 → 200; qase-server banner OK; custom LLM gateway (z-ai/glm-5.2 @ llm.drytis.ai) loads from env keys
- Pod Caddy: Host qase.drytis.com over http://:80 → 200 (routes to 127.0.0.1:5173)
- Pod-side HTTPS (:443) uses Caddy-internal self-signed certs by design — TLS is terminated upstream; do NOT misread pod :443 handshake failure as a bug
- Platform-managed hostname https://prod-qase-2-1-mkqetf.drytis.dev/health → 200 (gateway→pod works)
- DNS: qase.drytis.com → 147.135.77.206 (cluster A-record, matches apex_ips)
- Edge TLS: valid Let's Encrypt cert CN=qase.drytis.com (issued Aug 26 2026, YE2) — hostname is REGISTERED at the edge

## Verified BROKEN
- Edge custom-domain routing for qase.drytis.com does not deliver traffic to deployment #152's pod.
- `custom_domains` API for the deployment returns [] (no route row).
- 502 persisted across THREE pod IPs: 10.2.146.204 (original) → 10.2.146.225 → 10.2.0.53 → 10.2.145.111. Not a stale-pod-IP problem.
- Unknown hostnames on the edge: TLS connection just fails (curl exit 35, no 502) → the 502 is edge-generated for a KNOWN-but-unrouted hostname.

## What was tried (did not fix)
1. restart_production → new pod IP, still 502
2. redeploy_production (full service recreate, config re-pushed, git gate clean — commit 1f74053 shipped) → still 502
3. update_production_config (fresh config tar, routing re-register attempt) → still 502

## Conclusion / what's needed
Platform-side fix at the tls-edge/gateway: the routing entry for qase.drytis.com is missing or held (most plausibly by stopped deployment #129, which previously served the domain). Likely fix is releasing #129's hold on the hostname — but #129's volume holds rollback data (.qase/ runtime data), so per the handoff note: extract anything needed from #129 BEFORE releasing it.

## Constraints from handoff
- Do NOT restart #129 (it would re-claim the domain).
- DNS is already correct (A → 147.135.77.206); nothing to change at the DNS provider.

## Related tickets
#10964 (open, In Progress) — this investigation. Also #10927 (earlier reclaim), #10848 (take over domain).
