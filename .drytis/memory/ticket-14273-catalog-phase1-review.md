# Review: #14273 Catalog Phase 1 · Data expansion — PASS

Reviewed against .drytis/specs/catalog-phase-1-data.md. All 9 criteria PASS.

- Scale: 163 devices / 36,619 envs, catalog version 2027.01.0. Ticket text said "144 devices" and spec said "~220–260" — both off vs actual 163; env count exact. Counting-convention discrepancy, not blocking.
- macOS envIds now carry OS token: ENV-MAC-MACMBP14-M3-SONOMA-CHR-140 (hardware models replaced pseudo-devices; Intel caps at Monterey/Ventura).
- Limit clamp raised 20000→50000 across app.js API validation, local backend list, postgres repo list, facets, and 3 public/app.js fetches.
- Retirement: local backend marks active:false + retiredFromCatalog; postgres repo `UPDATE ... active=FALSE ... env_id <> ALL($3)` — never deletes, never resurrects active.
- WIN2IN1 deviceType 'two-in-one' threaded catalog→seed (windows-2in1 category).
- Known non-issues: `mac()` factory is now dead code in environmentCatalog.js; iPad Pro 12.9 implemented 3rd–6th gen (spec said 1st–6th, ticket said 3rd–6th — ticket wins).
- Styles.css/index.html changes in the same diff are the separate 1024px dead-zone fix (see 1024px-deadzone-fix.md), not catalog work.
- Tests: 1059 pass / 20 skip / 0 fail. validate-matrix.mjs ALL CHECKS PASSED (live checks need QASE_VALIDATE_COOKIE).
