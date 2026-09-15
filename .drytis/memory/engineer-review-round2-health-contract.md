# Engineer review loop — rework round 2 (2026-09-15 evening)

Engineer re-review after round 1 flagged two checks; both fixed in commit
873f770 (+docs f228f2b, fa3a8e8), deployed to preview + prod platform URL,
tickets #10964 and #10638 returned to In Review and re-sent.

## #10964 — /api/health contract flipped
The engineer's check expects `/api/health` to answer **401
{"error":"Authentication required."}** — i.e. the endpoint must sit BEHIND the
/api auth gate like every other API route. The previous "unauthenticated
fingerprint" design (200 for anyone) was wrong for this review. Route moved
after the gate; authenticated callers get {status, service, accessMode,
requestId}. Test rewritten to wire auth before app creation. Note: engineer
checks run against the PUBLIC urls (preview/platform URL), not the pod.

## #10638 — discoverability
The /qase-test command existed but was invisible in the UI. POST /api/sessions
now seeds every new QA run with a system message advertising
`/qase-test <unresponsive-runtime | runtime-reuse-block>`. Founder/SQA routes
and direct store creation do NOT get the hint (by design). Six older test
assertions expecting zero messages on new runs were updated to the new
contract where they go through POST /api/sessions.

## Ops gotchas confirmed again
- Pod restarts wipe the pod-local Caddy catch-all patch (platform-URL 404);
  re-apply from /etc/caddy/Caddyfile.bak-873f770 pattern: insert
  reverse_proxy 127.0.0.1:5173 handle before the "Not Found" catch-all in the
  :80 block, caddy validate + reload.
- qase.drytis.com app paths still edge-502 (custom_domains → []); /health on
  the domain 200. Platform-side.
- CSRF: POST /api/sessions needs cookie qase_csrf + x-csrf-token header after
  login; login does NOT need CSRF.
- npm test output once showed a stale "9 !== 7" fragment; three clean reruns
  505/496/0/9 — trust repeated runs.
