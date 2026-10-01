# Migration renumbering hazard — NIHARIKA-numbered databases (ticket #14179)

Merged NIHARIKA + PUSHKAR into DEV (commits 9b1f403, 6d3b9d2 + fix 0d-chase). Final numbering: 001-029; NIHARIKA's 015-018 (environments/device_catalog/test_cases/cross_platform) became 023-026; her unique 019-021 (device_runtime/bugs/test_case_provenance) became 027-029. PUSHKAR's 021-024 were the same 4 files as NIHARIKA's 015-018 → resolved to the 023-026 renumbering.

## Hazard
The migration runner (server/postgres/migrations.js) is forward-only with version PK + name UNIQUE + sha256 checksums. Any DB that already applied NIHARIKA's migrations under her 015-018 numbering will HARD-FAIL at startup ("name mismatch" / "not a known contiguous prefix"). There is no alias/rename path. Such DBs must be recreated or manually repaired (rename rows in qase_schema_migrations).

Prod (qase.drytis.com) is SAFE: it ran 001-022 under DEV numbering; 023-029 apply cleanly on top.

## Review
Reviewer PASS on all 6 items (migrations, security, routes, app.js wiring, styles cascade, markers) after removing one stray `=======` at styles.css EOF. Suite 1069/0 fail; verify green; app serving with cli-theme + sidebar-nav.