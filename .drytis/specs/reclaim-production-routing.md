# #10927 Reclaim qase.drytis.com routing and deploy current Qase

Deploy the current project 3542 preview version to the user-provided qase.drytis.com domain. Preserve production data and unrelated local files.

## Acceptance criteria
- [x] Check incoming changes before editing; origin/main matches local 01591df.
- [x] Verify release regression checks: npm run verify passed, 477 tests, 468 passed, 9 skipped, 0 failed.
- [ ] Pass infrastructure verification, independent release review, and browser checks.
- [ ] Verify selected project production configuration and routing ownership.
- [ ] Publish only verified release code and confirm deployed revision matches.
- [ ] Verify production HTTPS, readiness, application identity, and login UI.

## Current platform blocker
Follow-up live check: production recovered to HTTP 302 at `/`, but `/readyz` is 404, `/api/health` is public HTTP 200 with project Qase, and `/openapi.json` is HTTP 200 OpenAPI 3.1.0 version 1.1.0. Source remains readiness 200, health 401, OpenAPI 404. Thus recovery does not establish intended application identity; the previous fingerprint discrepancy is reproduced. Independent infrastructure verification passes source process/proxy/readiness checks. Independent reviewer confirms production operations are blocked until scoped control-plane access and current domain ownership are available.

Latest execution attempt: production `/` returns HTTP 502 with successful TLS verification; production `/readyz` also shows Bad Gateway. Source `/readyz` returns `{"status":"ready"}`. These live observations supersede the older wrong-application fingerprint below; current routing ownership cannot be established while the control plane is inaccessible. Project selection still returns an async_generator literal, details still fails for missing API_BASE_URL, and production status/shell report no selected project. No production mutations or restarts performed. Current production revision, data integrity, rollback state, and authenticated smoke tests remain unverified.

Drytis select_project returns a literal async_generator representation. get_project_details reports missing API_BASE_URL; production status and production shell report no selected project. Prior deployment notes report a domain routing conflict. Do not infer release success from HTTP 200 or a login redirect alone.

## Infrastructure and review results
- Local production command node server/index.js and root Caddy proxy to 5173 verified; managed services running, no stray dev server. Preview /readyz HTTP 200.
- Production /openapi.json HTTP 200 (OpenAPI 3.1, version 1.1.0), /api/health public project Qase response, and /readyz 404 differ from preview (OpenAPI 404, API health 401, readiness 200). Domain still serves a different application.
- Historical direct deployment hostname prod-qase-2-1-mkqetf.drytis.dev now returns plaintext 404. Its current deployment identity/status cannot be established.
- Independent release review BLOCKED: HTTP success alone cannot prove application or revision identity; control-plane configuration and production revision must be verified before deployment.
- No production changes performed. Platform operator must restore selected-project API access and verify/correct domain mapping to project 3542 while preserving existing data. Then resume full deployment gate and verify actual production revision.

## Follow-up investigation — 2026-09-15

### Observed call chain and limits
- `drytis_project_info()` resolves the session attachment as project 3542 and the supplied preview URL.
- `drytis_propose_projects()` and `drytis_list_projects(search="qase")` fail during API-client initialization: `API_BASE_URL must be set in environment variables or passed to constructor`.
- `drytis_select_project(project_id="3542")` returns a text block containing a JSON-quoted Python representation `<async_generator object ProjectToolkit.select_project at ...>`.
- `drytis_get_project_details(project_id="3542")` independently fails API-client initialization. The caller supplied a string ID, not the generator.
- Production status, production shell, and custom-domain lookup reject the request with `No project selected. Use select_project first.`
- This establishes a generator escaping through the remote tool-result serialization boundary, and selection state not being established. It does NOT establish the exact internal wrapper line, yield semantics, or that details receives a generator; those require the remote implementation.
- No ProjectToolkit Python implementation found in the repository or searched local runtime locations (/drytis, /dependency, /home/coder/.drytis, /usr/local/lib). The provided tools expose calls, not server implementation or runtime administration.

### Required external repair/access
Access to the Drytis MCP server implementation and its runtime configuration is required. Inspect the wrapper calling ProjectToolkit.select_project, distinguish awaitables from async iterators, consume async-generator events with `async for` according to the actual event contract, and extract/validate the final project result before serializing or establishing selection. Do not blindly collect progress events and treat them as projects. Reject unresolved generators and invalid/missing IDs. Add wrapper regression tests proving generator execution, final selection state, error propagation, valid ID passage to details, and no generator serialization. Configure the server's legitimate API_BASE_URL and existing authenticated client/session. Changing the QASE app's .env cannot configure this remote MCP process.

### Current verification
Live remote main and local HEAD both match 01591df5a7f8750318e8089271b7edcceeaa3e30. No release code changed or deployed in this investigation.

| Check | Source | Production |
|---|---|---|
| `/` | 200 Qase autonomous QA agent | 302 to /login |
| `/login` | 404 | 200 Sign in — QASE |
| `/readyz` | 200 ready | 404 |
| `/api/health` | 401 authentication required | 200 public project Qase |
| `/openapi.json` | 404 | 200 OpenAPI 3.1, API v1.1.0 |
| Frontend assets | entry.js, entry-motion.js, app.js | login.js |

Both frontends use relative same-origin /api endpoints. Production login additionally calls /api/auth/bootstrap and supports register-admin/signup then redirects to /runs. This is a different application surface, not evidence of an absolute frontend API-base mismatch. Live domain ownership remains unverified; historical project 2516/deployment 152 notes are not current authoritative identification.

Source configuration: root Caddy reverse proxy to 127.0.0.1:5173; service command node server/index.js. Frontend API /api; authentication /api/auth/login; updates use SSE /api/sessions/:id/events rather than WebSockets. Cookies are host-only, Path=/, SameSite=Lax, session HttpOnly; Secure is enabled for production/HTTPS requests. Origin validation rejects cross-site/mismatched hosts; trusted forwarded host depends on QASE_TRUST_PROXY. QASE_PUBLIC_URL in source targets preview and must resolve to production in production for keepalive/integration launch URLs. No separate frontend API-base environment setting or OAuth callback configuration found. Production environment, proxy, cookies and host settings cannot be inspected through the broken control plane.

Public HTTP probes and independent browser smoke tests confirm no current 502 and different login artifacts. Authenticated login, session persistence, core QASE workflows, actual production revision, restart survival, and production data integrity remain unverified. No production mutations performed. No implementation fix claimed; the missing dependency is remote MCP implementation/runtime administration and restored scoped production access.
