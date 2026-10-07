# Phase D8 — Acceptance Validation & Regression

## Goal
Verify all 11 acceptance tests from the customer request.

## Changes
- E2E suite covering: iPhone selection (honest REAL/VIRTUAL per runtime availability + attestation), Android phone (manufacturer/model/OS correct), iPad (tablet metadata, orientation, touch verified), camera / mic / screen-share tests verify actual capability, unavailable device → NOT AVAILABLE no fake execution, bulk across devices → per-execution runtime sessions, busy device → BUSY + no silent switch, attestation failure → not REAL DEVICE + BLOCKED, unsupported combo → NOT SUPPORTED.
- Full existing test suite regression (602+ tests) + visual pass of run screen/right panel at common widths.

## Files
test/ or server/*.test.js additions, playwright E2E specs.

## Acceptance
- [ ] All 11 customer acceptance tests demonstrably pass or fail for the honest reason
- [ ] Existing suite green; no regressions in run flow, matrix, bulk runs
- [ ] App loads and normal single-device run works end to end

## Tests
The suite itself.
