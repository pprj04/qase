# meeting.drytis.dev is RFC1918 in-cluster — needs the private-host allowlist (2026-09-15, #10897)

**Durable fact:** inside the Drytis cluster, split-horizon DNS resolves
`meeting.drytis.dev` → `10.3.87.24` (RFC1918). `studio.drytis.ai`,
`workspace.drytis.ai`, `llm.drytis.ai` resolve publicly (Cloudflare /
15.204.178.28).

**Why it broke:** release `1be3796` (review hardening) turned private-network
guards default-ON in every environment. The browserPolicy studio→meeting
alias (#10897, first round) only fixes the *scope* check; the *private-IP*
check then blocks the meeting host on direct nav, and subresources/websockets
go through the same `evaluateRequest` check. The studio redirect chain worked
only because redirects aren't re-validated.

**Fix:** env key `QASE_BROWSER_ALLOWED_PRIVATE_HOSTS=meeting.drytis.dev`
(backend id 50925, /workspace/.env). `hostRuleMatches` does exact-host match —
siblings like other.drytis.dev stay blocked. Block messages in
`server/browserPolicy.js` now name the env var for self-diagnosis.

**Verified with real cluster DNS:** evaluateNavigation + evaluateRequest(top
and subresource) + wss all allowed for the meeting host; sibling private host
still `BROWSER_PRIVATE_NETWORK_BLOCKED`. Regression test in
`browserPolicy.test.js` ("QASE_BROWSER_ALLOWED_PRIVATE_HOSTS exempts only the
exact first-party meeting host"). Full suite 506/497+9skip/0fail.

**Prod note:** the live qase.drytis.com instance gets the key when the config
tar is pushed (update_production_config + restart_production) — the env key
default is shared across scopes. Don't set `QASE_ALLOW_PRIVATE_NETWORK=true`:
that's the global bypass; the host allowlist is the scoped mechanism.
