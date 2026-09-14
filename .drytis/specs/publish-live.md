# #10840 Publish all verified changes to live

Promote the existing verified DEV revision to origin/LIVE without changing application code or restarting services.

- [x] Check incoming changes: LIVE has zero incoming revisions and is an ancestor of DEV.
- [x] Confirm release source bdc7d6d7800151186aeccf8ca6c2f590f5854447 includes all four outgoing revisions.
- [x] Complete regression verification: serial suite passed 463 tests, 6 skipped, zero failures; recorded on ticket.
- [x] Confirm existing preview returns HTTP 200.
- [x] Publish using a non-force update and verify remote LIVE equals bdc7d6d7800151186aeccf8ca6c2f590f5854447.
- [x] Preserve excluded customer attachments and runtime data locally.

This operational spec is local bookkeeping; publish the existing release revision unchanged.
