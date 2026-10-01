# Device Matrix UI browser test — 2026-09-29 (Phase 3 round 2)

Steps 1–3, 5 PASS (dialog+4 tabs, facet counts, search filter, per-model OS list,
builder cross-product with real Chrome versions 138–141, 403 catalog-write gate).
Step 4 (environment editor) PARTIAL FAIL: orientation edits via the UI do not persist.

## Root cause (found, not fixed)

The UI editor Save calls `api()` with `headers: { 'content-type': 'application/json' }`.
The shared `api()` helper in public/app.js already sets a content-type header, so the
browser sends a **duplicated** header value `application/json, application/json`
(verified in the network request). The server's JSON body parser then treats the
content-type as non-JSON and leaves `request.body` as `{}` (or undefined), so
PATCH /api/environments/:envId returns 200 but applies no fields.

Evidence:
- UI Save (landscape): PATCH 200, body `{"orientation":"landscape","executionProvider":"browserstack"}`,
  refreshed GET had NO `orientation` key; row cell stayed "—".
- Direct fetch with single clean `Content-Type: application/json` header: same body
  persisted fine (orientation: landscape), GET confirms.
- UI Save (portrait): PATCH 200 with body `{"orientation":"portrait",...}` — record
  stayed "landscape" (the value from my direct fetch), i.e. ignored again.
- Response JSON omits orientation/screenResolution keys entirely when the record
  has them as undefined? No — after successful direct PATCH the keys appear.
  Keys absent = record never had them set (540 seeded envs have no orientation).

## Other notes
- Toast on save fires ("…updated.") even when nothing was persisted — misleading.
- After my test the record ENV-IOS-IP11PROMAX-17.0-CHR-138 was left at
  orientation: portrait (server default for mobile), close to original (unset).
- Add-to-catalog 403 for developer role surfaces correctly via toast.
- Console errors seen: 401 /api/auth/me (pre-login, benign), 400 (my deliberate
  invalid-orientation probe), 403 (expected role gate). No JS exceptions.
