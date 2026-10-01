# Device Matrix editor re-test — 2026-09-29 (round 3, narrowed: duplicated content-type fix)

## Original bug (round 2) — FIXED
Duplicated `content-type: application/json, application/json` header on UI editor
PATCH. Round 3: both UI Save PATCH requests (#26 landscape, #32 portrait) carried a
**single** `content-type: application/json` header; request bodies parsed and
persisted (PATCH responses returned the new orientation; single-record GET confirmed).

## New/remaining finding — stale post-save list refresh (read-your-write lag)
The editor's auto list refresh immediately after Save returns the PRE-patch state,
so the row's Orientation cell still shows the old value right after a successful
save (toast "…updated." fires correctly):

- Save landscape: PATCH 200 → orientation landscape in response; immediate list GET
  (#27) row had NO orientation key; UI cell stayed "—". Later manual refresh
  (Next/Prev) → cell correctly "landscape".
- Save portrait: PATCH 200 → portrait in response; immediate list GET (#33) row
  still showed landscape / updatedAt of the PREVIOUS patch; UI cell stayed
  "landscape". Later refresh → cell correctly "portrait".
- Controlled probe: PATCH portrait→landscape (200), immediate list GET → still
  portrait; 1.5 s later list GET → STILL portrait (old updatedAt); single-record
  GET after that → landscape. So list reads lag writes by well over 1.5 s; the
  single-record endpoint is read-your-write consistent. This looks like a local
  run-store list-read cache/path issue, NOT a frontend bug — the frontend renders
  exactly what the (stale) list response contains.

Verdict summary: header fix PASS; save→row-updates-immediately expectation FAIL
(stale list read). Record left at orientation: portrait.

## Pre-existing unrelated console error (present before this phase's changes, boot path)
`ReferenceError: snapshot is not defined at renderReport (app.js:1707) —
applySessionSnapshot — selectSession — bootWorkspace — boot` — fires on page boot
with a restored previous session. Not part of this fix; reported, not investigated.
