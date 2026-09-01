# Fix: "Model API not working" — 401 Invalid or missing API token

## User report
Screenshot showed the Qase dashboard with a red toast during a studio.drytis.ai
test run: `Invalid or missing API token. Set Authorization: Bearer <token> header.`

## Diagnosis (evidence)
1. **LLM gateway is healthy** — `https://llm.drytis.ai/v1/models` and
   `/chat/completions` both return HTTP 200 with the configured key
   (`QASE_API_KEY`, hint ••••L0mQ). The configured model `z-ai/glm-5.1` is in
   the gateway's model list. `/api/config` reported `ready: true`,
   `hasApiKey: true`, `problem: null` even BEFORE the fix.
2. **The 401 text is Qase's own middleware** (`server/index.js` line ~333,
   `requireApiToken`) — not the LLM gateway's error (gateway says
   "Authentication Error, No api key passed in." / LiteLLM token_not_found).
3. **Root cause — stale server process.** The `qase-server-v2` background
   service process was started at 14:16:40 UTC. The user's main-branch fetch
   (14 commits, incl. D0.5 scoped UI access codes) landed at ~14:18 UTC.
   `express.static` served the NEW `public/` UI from disk while the Node
   process still ran the OLD pre-D0.5 server code.
   - The new UI's login flow POSTs `/api/auth/session` — a D0.5 route that
     does not exist in the old process → falls through to the master-token
     gate → 401 with EXACTLY the error text in the screenshot.
   - Confirmed pre-fix: `curl -X POST /api/auth/session` (no auth) returned
     `{"error":"Invalid or missing API token..."}` instead of the D0.5
     handler's own `{"error":"Invalid access code."}`.
4. Secondary: `/home/coder/.gitconfig` was corrupted (binary garbage) breaking
   every git read; the update also added the `ws` dependency (node_modules
   needed a refresh before restart).

## Fix applied
- [x] `npm install` (ensure `ws` dependency present)
- [x] Repaired `/home/coder/.gitconfig` (valid user identity config)
- [x] Restarted `qase-server-v2` via procmgr (now runs current main @ 609cd58)
- [x] Verified `/api/auth/session` bad-code → 401 `Invalid access code.`
- [x] Verified full D0.5 flow: mint code (admin) → login → cookie → whoami
- [x] Verified `/api/config` ready/hasApiKey, preview URL HTTP 200
- [x] End-to-end model test: sent "Say OK and nothing else." to a live
      session → agent replied "OK" (model API working through full agent stack)
- [x] Cleaned up probe artifacts (2 test sessions deleted, test access code
      revoked)

## Acceptance criteria
- [ ] `POST /api/auth/session` with a wrong code returns `Invalid access code.`
      (its own handler), not the master-token error
- [ ] Login with a valid team access code returns 200 + qase_session cookie
- [ ] Whoami with the cookie identifies the session role
- [ ] `/api/config` reports ready=true, hasApiKey=true
- [ ] Agent responds to a chat message (model API functional end-to-end)
- [ ] Preview URL serves the dashboard (HTTP 200)
- [ ] No stale-code symptoms: server process start time AFTER latest commit

## Tests
- `tests-real/ui-access.test.js` — 20/20 pass (D0.5 auth suite, live server)
- `tests-real/b0-restart-config.test.js` — 1/1 pass
- `tests-real/c4-config-encryption.test.js` — 7/7 pass

## Notes
- UI access sessions (D0.5) are in-memory only; container restarts invalidate
  them — teammates just re-enter their access code (codes are persisted,
  hashed, in `.qase/ui-access.json`). Not part of this fix.
