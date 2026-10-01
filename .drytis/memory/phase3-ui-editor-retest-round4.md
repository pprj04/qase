# Device Matrix editor — round 3 re-test (final): RESOLVED

Login as tester@qase.dev. Fix under test: `Cache-Control: no-store` on `/api/environments` list responses (previously `private, max-age=60` caused >1.5s stale reads after PATCH).

## Result: PASS
- Edit `ENV-IOS-IP11PROMAX-17.0-CHR-138` → Orientation=landscape → Save: row cell flipped to "landscape" on the automatic refresh, no manual re-fetch needed.
- Edit same row → portrait → Save: toast "ENV-IOS-IP11PROMAX-17.0-CHR-138 updated." captured; row cell showed "portrait" immediately.
- Network evidence: PATCH #27/#29 → 200; immediate follow-up list GETs #28/#30 returned the NEW orientation ("landscape"/"portrait" resp.) with response header `cache-control: no-store` — the round-2 staleness is gone.
- Single `content-type: application/json` header on PATCHes (round-2 header fix still intact).
- Console: only the benign pre-login 401 on `/api/auth/me`; no JS errors from the editor flow.

Record left at orientation "portrait". All prior round failures (duplicated content-type header; stale list) are now resolved in the UI.