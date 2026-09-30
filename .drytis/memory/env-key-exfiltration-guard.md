# Env-key exfiltration guard — design and pitfall

Phase 6 (#12958) closed a HIGH finding: open registration + user-set baseUrl let
any registered user exfiltrate the instance's gateway key (QASE_API_KEY) via
/api/config/test and the agent runtime.

## The pitfall (cost a review round)
`getConfig()` merges layers: env is the default, user settings win. So a merged
config's `apiKey` ALWAYS equals the env key when the user stored none — the
first guard version compared `config.apiKey === envKey` and bailed out
"allowed". The guard must decide on the STORED layer (`readStored().apiKey`,
which inside a request is the per-user sealed settings via
`withUserConfiguration` AsyncLocalStorage):

- no stored key OR stored key === env key  → env key in use → baseUrl host
  must be in allowlist (QASE_BASE_URL host + QASE_ALLOWED_MODEL_HOSTS, exact match)
- stored genuinely different key           → user's own key, anywhere allowed

Also guard the empty-baseUrl case (provider-managed endpoints) and wrap
`new URL()` — raw TypeError surfaced as 500 instead of friendly 400.

## Files
- server/config.js `assertEnvKeyDestinationAllowed` + exported wrapper
  `envKeyDestinationProblem(config, environment)` (default process.env)
- Wired in: `testConnection` (probe) and agent.js `ensureRuntime` (runtime)
- server/securityRegression.test.js — 9 tests incl. the merged-config
  laundering regression (uses withUserConfiguration to simulate stored states)

Reviewer round 2: PASS, empirically re-proved with capture server; env key
never left the box in any state.
