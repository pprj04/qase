# Phase 17 · Validation suite: no fake device results + backward compatibility

## Goal
Prove the honesty contract end-to-end and that nothing existing broke. A validation suite that fails if any execution claims a level it didn't verify, plus regression over all prior surfaces.

## Validation rules (scripts/validate-device-runtime.mjs + server tests)
1. Every run record with deviceSession.level==='real' has verified===true and as-executed device/os/browser matching the requested environment.
2. No run in either store has level real with providerId 'local-chromium'.
3. Report/PDF text for every stamped run contains its level; unstamped (legacy) runs contain none.
4. BrowserStack-missing-creds runs show requestedLevel + "not available" reason.
5. NOT SUPPORTED permission/feature results never appear as PASS in findings.

## Regression checklist (running app)
- [ ] Full npm test suite green (incl. new phases 13–16 tests)
- [ ] Legacy device dropdown runs (desktop/mobile profiles) still work
- [ ] Test cases CRUD + multi-env assignment + one-click run + wizard + quick actions + bulk progress intact
- [ ] Catalog CRUD (admin), drawer browse/build/saved flows intact
- [ ] Reports (md/pdf), findings, SQA, Founder, agent log, transcript, evidence viewer intact
- [ ] Migration chain 001→019 applies cleanly on fresh Postgres; local store unaffected
- [ ] Roles: developer cannot write catalog; tester flows unaffected
- [ ] Layout intact at 1280px and 768px; dialogs don't overlap

## Tests
- server/deviceRuntime/validation.test.js — rules above as automated tests over both stores
- scripts/validate-device-runtime.mjs — live preview sweep (authenticated), exit non-zero on violation
- Postgres migration replay test update
