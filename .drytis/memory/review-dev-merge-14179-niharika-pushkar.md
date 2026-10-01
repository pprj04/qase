# Review: DEV merges 9b1f403 (NIHARIKA) + 6d3b9d2 (PUSHKAR), ticket #14179

Board ticket #14179 was NOT found in the repo (`.drytis/` or grep) — merge plan
lives only in the commit messages of 9b1f403 / 6d3b9d2 / 3a3dd17.

## Findings
1. Migrations 001-029, no dupes; headers match filenames; migrations.test.js
   asserts 1-29 order via `-- Qase PostgreSQL migration NNN` headers. PASS.
   RISK: any DB that ran NIHARIKA's 015-018 under her numbering will HARD-FAIL
   at startup — migrations.js validateAppliedMigrations does strict
   version+name+sha256 match ("name mismatch / not a known contiguous prefix").
   Prod (001-022 DEV numbering) is safe. NIHARIKA's own DB must be recreated.
2. One leftover conflict marker: `public/styles.css:11167` is a bare `=======`
   introduced by 6d3b9d2 (git blame confirms). Harmless to browsers (invalid
   selector at EOF, brace balance still 0) but must be deleted.
3. CSS cascade: zinc-dark :root at line 3, Studio light-first :root at 5181,
   prefers-color-scheme dark override at 5223 — coherent (later wins; dark
   media query restores dark values).
4. app.js wiring verified (qaUi.environmentSelect, selectedEnvironmentForRun
   fallback store→select, createQaRun keeps selectedTests/securityAuthorization,
   envUi ids all present exactly once in index.html).
5. app.js routes fine; `app.post('/api/auth/invites'` appears twice but is
   INTENTIONAL middleware-chaining (throttle then handler) from 687aed9, not
   merge damage.
6. No hardcoded creds; BrowserStack creds from env (browserstackProvider.js).
   401 on unauth /api/environments, /api/coverage, /api/engines confirmed.

npm run verify green (full suite). Did not fix anything (review-only).
