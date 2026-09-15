# #10967 — Backend architecture, per-user instances, and caching

## Scope
Review current backend and pre-existing uncommitted agent changes. Distinguish account-scoped data from dedicated process/container isolation. Fix demonstrated isolation or cache defects with regressions; do not introduce a new provisioning platform or claim unmeasured production qualification.

## Acceptance criteria
- [ ] Document account, tenant, process, storage, and browser-runtime boundaries with code evidence.
- [ ] Inventory cache/state isolation, expiry, and memory bounds; distinguish authoritative local storage from disposable caches.
- [ ] Add regression tests before implementing demonstrated cache/isolation fixes.
- [ ] Evaluate pre-existing agent/progress-stream changes without discarding them.
- [ ] Run relevant unit/integration tests and independent tester/reviewer/infra verification; document unavailable infrastructure evidence explicitly.
- [ ] Record findings, fixes, tests, and remaining qualification requirements on #10967 and return it to In Review when built and tested.

## Verification
Use deterministic tests for cross-account access, cache headers and state lifetime. Tester owns live browser checks against the configured preview. Infrastructure review must inspect actual available service configuration and HTTP probes; source templates alone cannot qualify production. No publish or production deployment in this task.
