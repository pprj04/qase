# Phase 3 · Apple Device Matrix UI

**Ticket:** #13437 · **Spec owner:** leader · **Status:** In Progress

## Goal

A dedicated **Apple Device Matrix** section in the existing vanilla-JS frontend where an
operator can:

1. Browse the full device catalog (categories → models → generations → OS families →
   OS versions → browsers + versions) with search + filters on every dimension.
2. Multi-select devices / OS versions / browsers and see the resulting valid
   combinations (compatibility validated server-side via `/api/catalog/validate`).
3. Create testing environments from selections, in bulk, plus full CRUD and
   enable/disable on existing environments.
4. Add new devices, OS versions and browser versions through the UI — data-driven
   catalog writes (`POST /api/catalog/:entity`, owner/admin gated) so no code change
   is ever needed.
5. Stay usable with hundreds of combinations: paginated/virtualized lists, facet
   counts, debounced search, lazy loading of OS versions per model.

## Backend support (already built in this ticket)

| Endpoint | Purpose |
|---|---|
| `GET /api/catalog/:entity` (+`/:id`) | Catalog reads with exact-match filters |
| `GET /api/catalog/validate` | Data-driven device+OS+browser compatibility check |
| `GET /api/catalog/facets` | Counts per dimension for filter chips |
| `GET /api/catalog/deviceModels/:id/osVersions` | OS versions compatible with a model |
| `GET /api/catalog/browsers/:id/versions` | Browser versions for a browser |
| `POST /api/catalog/:entity` | Create catalog entities (owner/admin) |
| `GET/POST /api/environments/bulk` | Bulk list + bulk create environments |
| `POST /api/environments/bulk-toggle` | Bulk enable/disable environments |

## Files to change

- `public/app.js` — new Device Matrix section (module pattern like existing sections)
- `public/index.html` — nav entry + section container
- `public/styles.css` — matrix table styles, chips, bulk bar, empty states
- No backend changes required beyond what is already merged above.

## Acceptance criteria

- [ ] Device Matrix section reachable from the main navigation
- [ ] Catalog browse view lists categories/models with search and per-dimension filters
- [ ] Multi-select of devices + OS versions + browsers shows only valid combinations
- [ ] Environments can be created from selections in bulk (validates, skips dups)
- [ ] Environment list supports edit (resolution/orientation/description/provider) + enable/disable
- [ ] New device model, OS version and browser version can be added from the UI
- [ ] UI remains responsive with 500+ rows (pagination or windowing, no blocking)
- [ ] Existing UI sections unaffected (regression: environments modal still works)
- [ ] Unit tests for UI helper functions (combination expansion, env-id fallback)
- [ ] Integration tests for the new endpoints pass (done — 8 added)
- [ ] Infra gate + reviewer + tester verification pass

## Tests

- Unit: `server/environmentApi.test.js` (endpoints, added in this ticket)
- Unit: UI helpers (`expandSelection`, `buildEnvIds`) — colocated in public/app.js
  and tested via node --test with a small DOM-less harness
- Browser: tester sub-agent verifies nav → browse → filter → bulk create → toggle flow
  with credentials from `/workspace/.drytis/cred.json`
