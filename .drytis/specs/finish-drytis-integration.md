# Phase 9 · Finish Drytis integration (QASE side)

Ticket: #12961. Branch: PUSHKAR. Written 2026-09-27.

## Research conclusions (from codebase audit)

- Server data plane is solid: full `/internal/v1/drytis` review API (create/get/start/stop/deliver) with HMAC auth, idempotency, Postgres nonce store, delivery push. Tested extensively.
- **The gap is the QASE dashboard UI and the ticket-push payload**: `session.drytisIntegration` is serialized to the browser by `GET /api/sessions/:id` but rendered nowhere; no findings→board push exists in any shape.
- Outbound delivery nonce flake (base64url leading `-`/`_` rejected by boundedToken) is real but dormant — flag `QASE_DRYTIS_INTEGRATION_ENABLED=false`. Fixing it server-side only (no contract change: nonce charset is opaque to Drytis) is safe.

## Scope for this ticket

1. **Tickets payload** — extend the Drytis-facing API so a review's findings can be delivered as discrete, board-ready tickets:
   - `POST /internal/v1/drytis/reviews/:id/push-tickets` (signed, idempotent like deliver): sends `{reviewId, project, tickets: [{id, title, body, severity, engine?, url, steps, expected, actual, evidence, accepted: false}]}` for all **accepted** findings to `QASE_DRYTIS_TICKETS_PATH` via the existing delivery client.
   - Acceptance state lives in `session.drytisIntegration.tickets = { acceptedFindingIds: [], pushedAt?, upstreamStatus? }` (additive blob fields, still under the 1MB cap).
2. **Dashboard UI — findings → board with accept-all**:
   - New "Drytis board" panel in the QA report view, visible only when `session.drytisIntegration` exists.
   - Each finding gets an accept checkbox (default checked); "Accept all" master checkbox; "Push to Drytis board" button calls the push-tickets endpoint via a new internal endpoint `POST /api/sessions/:id/drytis/push` (dashboard-authenticated, server-side signs outbound).
   - Post-push state rendered (delivered count, timestamp); per-finding push status chip.
3. **Nonce flake fix** — `drytisTransport.js` default `createNonce` → `randomBytes(24).toString('hex')` (opaque to the receiver; kills the 1-in-8 outbound test flake). Drytis-side client `integrations/drytis/qaseClient.js:204` same fix. User was asked in a previous session and work paused; this spec re-asks in the completion report.
4. **No enablement change** — flag stays `false`; all new code paths are dormant until Drytis-side onboarding (Phase 9 Studio side is a separate concern). UI panel only renders when integration data exists.

## Files

- server/drytisIntegrationApi.js — push-tickets endpoint + tickets state on the blob
- server/drytisTransport.js + integrations/drytis/qaseClient.js — hex nonce
- server/app.js — dashboard-facing `POST /api/sessions/:id/drytis/push` (+ accept-state mutation `PUT /api/sessions/:id/drytis/accept`)
- public/app.js + public/index.html + styles.css — Drytis board panel
- Tests: server/drytisTickets.test.js (payload shape, idempotency, accept filtering); UI static contract test; existing suites stay green.

## Acceptance criteria

- [ ] Signed `POST /reviews/:id/push-tickets` delivers only accepted findings as tickets; idempotent replay returns the cached result
- [ ] Dashboard: Drytis board panel with per-finding accept checkboxes, accept-all, push button — only for sessions with drytisIntegration
- [ ] Push state persisted and rendered after reload
- [ ] Nonce generator produces hex (regex `[0-9a-f]{48}`), outbound flake test passes 8/8 runs
- [ ] No behavior change when QASE_DRYTIS_INTEGRATION_ENABLED=false (endpoints 404, UI hidden)
- [ ] Full verify green

## Out of scope

- Drytis Studio-side board rendering (separate project)
- Enabling the integration in dev/prod (needs HMAC key + origins; an ops decision for Phase 10)
- PostgreSQL migrations (tickets state rides the existing jsonb blob)
