# Phase 24 · Validation suite + end-to-end regression (honesty proof)

## Goal
Prove the honesty guarantees end-to-end and that nothing existing broke:
scripted validation that (a) a SIMULATED run cannot be recorded as REAL
DEVICE, (b) labels come from recorded runtime facts, (c) permission
scenarios change actual browser behavior, (d) UA/DPR/touch applied per
profile, (e) all prior surfaces (catalog CRUD, environments, test cases,
bulk, drawer, reports, SQA, Founder) still pass.

## Files
- `scripts/validate-device-runtime.mjs` — headless end-to-end script (spawn
  real local server, create environment with scenarios, run small test
  target, assert runtime_facts: UA seen, DPR, permission outcomes, level
  recorded)
- `server/deviceRuntimeHonesty.test.js` — unit proof: label derivation only
  from attestation; downgrade paths never emit REAL DEVICE
- `server/postgres/migrations.test.js` — extend for migration 019
- Existing suites untouched-green

## Acceptance criteria
- [ ] Validation script passes locally and records its output as evidence
      in the phase notes; all honesty assertions hold.
- [ ] Full npm test green including new suites.
- [ ] Preview loads; spot-check: simulated iPhone run shows SIMULATED badge
      in run list, run screen, report.
- [ ] Prior-phase acceptance spot-checks (Phase 9-12) still pass.

## Edge cases
- CDP UA-override vs navigator.userAgent mismatch (Chromium lies in
  userAgentData) — assert consistent override.
- Local headless media pipeline (synthetic mic) must still pass its
  existing tests after permission scenario merge.
