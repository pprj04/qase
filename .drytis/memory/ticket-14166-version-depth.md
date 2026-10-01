# #14166 Catalog version depth (Done)

server/environmentCatalog.js @ 2026.10.2:
- 4 new macOS devices: HIGH-SIERRA 10.13, MOJAVE 10.14, CATALINA 10.15, BIG-SUR 11 (mac() builder; slugs used in envIds ENV-MAC-BIG-SUR-…). 'Golden Gate' from the reference image was NOT added (unreleased).
- MACOS_SAFARI_VERSIONS + High Sierra 11.1.2, Mojave 12.1.2, Catalina 13.1.3, Big Sur 14.1.2; Tahoe 26.2 → 26.4.
- safariVersionFor('macos') BUG FIXED: old key-normalizer only capitalized first char + lowercased rest, so 'Big Sur' never matched. Now exact match first, case-insensitive fallback.
- BROWSER_VERSIONS deepened: chrome 140–156 (+ legacy 138/139 kept in live store), firefox 141–158, edge 140–156, opera 122–137, brave 136–140, duckduckgo 1–3. Safari stays OS-derived.
- deviceCatalogSeed MACOS_CHRONOLOGICAL extended (High Sierra…Tahoe) for sort keys.

Capacity: ALL list caps 5000 → 20000 (API validation, envService list+facets, postgres repo, public/app.js 3 fetches, app.js seedBoard 10000→20000). Matrix = 14617 generated envs / 83 devices; live store 16301 rows (legacy operator envIds preserved).

Stale data cleanup: ENV-MAC-TAHOE-SAF-26.2 was a leftover row (envId no longer generated). PATCH active:false via API — needs cookie jar (qase_session + qase_csrf) AND 'x-csrf-token' header with the decoded csrf cookie value.

Login throttle reality (bigger PITA than before): 40/min per IP AND 10/15min per account, in-memory in service-bg-service-4182 → procmgr restart service-bg-service-4182 clears. Every acceptance run + probe burns one account attempt.

Acceptance script: fixed sleeps in openPicker()/pickDeviceCard raced the ~16k-env catalog render (cards at ~900ms); replaced with waitForSelector('#dp-cards .dp-card', {timeout:10000}). 3 consecutive PASS after fix.

Tests retargeted: 'Chrome 154'/'153' fixtures → 160 (154 now seeded); catalogVersion '2026.10.2'; matrix size 14000–16000; limit bounds 20001→400.

Chrome picker shows 19 options (138–156) on live store — 17 generated + 2 legacy active rows. Expected behavior, not a bug.

Changes UNPUBLISHED on NIHARIKA (with #14102/#14132/#14151 work).