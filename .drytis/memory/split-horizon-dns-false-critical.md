# False CRITICAL "site unreachable" — split-horizon DNS root cause

## Symptom
Firefox-engine QA run against https://www.drytis.com/ → all navigations time out / "Secure Connection Failed" interstitial (SSL_ERROR_BAD_CERT_DOMAIN). Run concluded Blocked with CRITICAL "fails TLS verification for all visitors". Chromium runs of the same URL worked.

## Root cause (not a site defect, not an engine bug)
1. www.drytis.com is a CNAME → drytis-website-bpdgc6.prod.drytis.dev
2. Container resolver (10.3.0.10) is SPLIT-HORIZON: querying the CNAME target directly returns ONLY internal pod IP 10.3.87.24 (public DNS returns Cloudflare 104.21.58.253 / 172.67.167.7)
3. That internal endpoint serves a *.drytis.dev cert → mismatch for www.drytis.com → Firefox interstitial
4. Firefox chases CNAME chains host-by-host more aggressively than Chromium/Node's resolver, so it intermittently landed on the internal IP (~40-60% of navigations)

Evidence: `openssl s_client -connect 10.3.87.24:443 -servername www.drytis.com` → CN=drytis.dev, SAN *.drytis.dev. Public chain valid (GTS WE1 → GTS Root R4, verify OK, curl 200). Node `dns.resolve4('www.drytis.com')` chases to public IPs, but `dns.resolveCname` hop + `resolve4(cname)` reveals 10.3.87.24.

## Ruled out (all tested, none fix)
HTTP/3 (h3-disabled 0/12 — worse), OCSP/CRLite prefs (incl. the browserEngines.js OCSP soft-fail set), IPv6-first DNS + dead v6 egress (disableIPv6/fast-fallback prefs), TLS 1.2-only, delegated credentials, GREASE/ECH, session identifiers, keepalive. Also NOT a generic Cloudflare issue (letsencrypt.org, discord.com, sqlite.org — all Cloudflare — 4/4).

## Fix (ticket #13288)
server/targetReachability.js — pre-flight probe resolving target + chasing CNAME chain (≤5 hops); private/reserved IP anywhere in the chain → ok:true + note 'split-horizon-dns' + human-readable detail; public resolution but failed TLS handshake → unreachable (real defect). app.js wires it at URL-bind: adds session.environmentNotes + warning system message (environmental, never a site defect); prompt.js renders '# Environment notes (authoritative)' section every turn. Tests: targetReachability.test.js (8/8), targetPreflight.test.js (6/6).

## Lesson
When a browser engine fails a site that openssl/curl/other engines verify clean, suspect the DNS view from the run container BEFORE blaming the engine or the site. Any *.drytis.com public site behind the same internal CNAME pattern will hit this.