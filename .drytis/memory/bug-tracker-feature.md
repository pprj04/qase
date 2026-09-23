# Bug tracker feature (tickets #12745/#12746/#12747, 2026-09-23)

Standalone cross-run bug tracking, built on the finding model.

## Design decisions
- Statuses: `open | in_progress | fixed | wont_fix` (+statusNote ≤500, statusTs). Defaults `open`; legacy findings backfilled on read (normalizeFindingStatus), Postgres migration 015.
- **PATCH route has NO role gate** — deliberately removed after browser testing: every real account on this instance is `developer` role, so an owner/admin gate made bug tracking unusable. Ownership is enforced by `requireSession` → actor-scoped `getSession(id, ownerUserId)`. Reviewer traced and approved this. Do not re-add a role gate without a role story for existing accounts.
- `aggregateFindings` in store.js delegates to store-agnostic `aggregateSessionFindings(sessionIterable, options)` so local and Postgres services share one implementation (Postgres aggregates over its in-memory sessions map).
- Aggregate rows carry expected/actual/steps/evidence for the detail drawer.
- `limit` query param must be coerced (`Number.isSafeInteger`) — Express delivers strings.
- Frontend: public/bugsView.js module (founderView.js factory pattern), public/bugsView.css (token palette only), launched from feature-dock "Bugs" button; `.app.is-hidden` swaps views. Status change is optimistic with rollback. SSE `finding` events coalesce to a 4s refresh when the view is open. `finding_status` SSE events do NOT live-refresh an open Bugs view (cosmetic gap, known).
- Page-cell links only http(s) URLs — scheme check prevents javascript: href from agent-supplied URLs.

## Gotchas found
- Postgres hydrate: `Number(null)` is 0 and passes Number.isFinite — guard null before Number(row.status_at).
- Test fixture sessions lack `mode:'qa'` — aggregator skips non-qa modes; set mode explicitly.
- Full-suite flakes: `server/drytisTransport.test.js` ('outbound client bounds payloads…') and `server/keepalive.test.js` ('keepalive swallows fetch failures…') fail intermittently under parallel load, pass in isolation — pre-existing, see drytis-transport-nonce-flake.md.

## Test account
- bugtracker-test@drytis.example / (in .drytis/cred.json), role developer, registered via /api/auth/register; owns seeded demo findings for browser testing.
