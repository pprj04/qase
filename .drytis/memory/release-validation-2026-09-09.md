QASE release validation (fresh clone /home/coder/qase-release @ 52a4560), 2026-09-09 — findings for later sessions:

VALIDATION VERDICT: QASE RELEASE NEEDS FIXES (product code is fine; 3 stale protected-core test copies in tests/ need syncing to tests-real twins — pure test-file fixes, no production changes).

Key results:
- tests-real canonical battery: ~1547 tests, 1466 pass / 70 fail raw; after env fixes + fixture seeding nearly all green. Failing suites resolve to: environment (no LLM key, no BrowserStack creds, no procmgr), aged-store expectations (>1000 findings/artifacts/missions — store-state), and stale tests/ copies.
- tests/ protected core has 3 STALE copies vs tests-real twins:
  1. tests/execution-provenance.test.js:79 uses old caps browserstack.user/key (renamed in C4.1 04bd5b2 to browserstack.username/accessKey) — tests-real twin updated & passes.
  2. tests/phase5-api.test.js + phase9.2-revalidate-e2e etc: pagination-stale (expect array where ?limit returns {items,...}, M1-P4.3 intentional) + hardcoded /workspace/.env reads.
  3. tests/phase16-api "findings list filters by new params" expects array with ?limit — same stale pagination.
- 15 suites across tests/ + tests-real hardcoded readFileSync('/workspace/.env') — harness bug, fixed in the validation clone (uncommitted) by pointing at repo-local .env.
- b1-security-negative expects wsA-int/wsB-int integration principals that NO suite creates — depends on prior store state; seeding them via POST /api/v1/integration/keys makes it 17/17.
- mission-governor live queue tests can't pass without a live LLM key (missions fail too fast to hold slots) — environment.
- Container quirk: orphaned (setsid/double-fork) background processes get reaped within ~1-3 min by infra; long-lived test servers must run as bg job INSIDE the same run_bash call as their tests.
- Workspace preview service (service-bg-service-3962 on 5173) was stopped during validation and RESTORED via `procmgr restart service-bg-service-3962` (note: no `start` subcommand; use restart/reload).
- Validation clone left at HEAD 52a4560 + UNCOMMITTED harness fixes (15 test files: /workspace/.env → repo-local .env path). origin/main untouched (ec8d549).