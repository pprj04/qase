# Quick fixes · engine title tag + private-host allowlist

Ticket: #13234. Branch: PUSHKAR. Written 2026-09-28.

## Problem

1. **Engine tag invisible in titles.** Server tags run titles for non-chromium
   engines (`POST /api/sessions` creates `QA — firefox`; the first message
   sets `host (firefox)`), but the frontend renders `hostOf(run.targetUrl)`
   in the run list (app.js:237) and the chat header (app.js:475), dropping
   the suffix. The adjacent engine pill exists in the run list only after
   selection; the header shows nothing. With multi-engine fan-out creating
   N parallel runs against the same URL, the list shows N identical titles.
2. **Internal E2E runs end 'Blocked'.** The agent browser's private-network
   policy refuses the instance's own preview origin (resolves to reserved
   network space), so QA runs targeting the demo site from the dashboard
   produce `BROWSER_PRIVATE_NETWORK_BLOCKED` and zero findings.

## Fix

1. `public/app.js` — in `renderRunList`'s title and `renderHeader`'s chat
   title, when the run/session engine is a known non-chromium engine, render
   the engine tag as a small chip appended after the host text (textContent
   only; reuse `.engine-chip` styling already used for findings). If no
   targetUrl, `run.title` already carries the tag.
2. Private-host allowlist — the bridge/browser policy already supports
   `QASE_ALLOW_PRIVATE_NETWORK` (dev). Add an instance-origin allowlist so
   the agent may always reach its OWN public origin even in production
   (the origin is the operator's own service, not an attacker-controlled
   target): resolve the host of `QASE_PUBLIC_URL` and treat it as public.
   No env key required beyond what exists; policy consults the origin host.

## Acceptance criteria

- [ ] Run list title shows a `firefox`/`webkit` chip next to the host for non-chromium runs; chromium runs unchanged
- [ ] Chat header shows the same engine tag for non-chromium runs
- [ ] An internal QA run against the preview/demo URL navigates instead of BROWSER_PRIVATE_NETWORK_BLOCKED
- [ ] Full verify green; no auth/schema/env changes

## Tests

- Extend the static UI contract test for the title-chip wiring.
- Browser-policy unit test: the instance-origin host is allowed while other
  private hosts stay blocked.
