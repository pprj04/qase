# Phase D3 — Attestation & Result Integrity (BLOCKED state)

## Goal
Attestation is the single source of truth for REAL DEVICE labeling.

## Changes
- Before a REAL_DEVICE test starts, build attestation object (execution_type, device_id, manufacturer, model, os, os_version, browser, browser_version, runtime_session_id, connected_at, capabilities_verified) — store in `qa_runs.runtime_facts.attestation` and with each result/artifact.
- Result gating: before PASS/FAIL display verify (1) test executed, (2) runtime connected, (3) device identity verified, (4) browser verified, (5) OS verified, (6) required capabilities available, (7) evidence belongs to this runtime session. Any failure → result `BLOCKED` with reason "Device runtime could not be verified." Never PASS.
- Evidence artifacts (`server/artifactStore.js`) embed attestation; artifact/evidence headers show "REAL DEVICE · <model> · <os> · <browser> · Runtime RT-XXXX".

## Files
server/deviceRuntime/manager.js, server/browserBridge.js (resolveExecution), server/artifactStore.js, server/store.js / runRepository.js, results UI.

## Acceptance
- [ ] A REAL DEVICE run without valid attestation shows BLOCKED, never PASS
- [ ] Passed runs carry a visible attestation (runtime session ID) in results and evidence
- [ ] Evidence header shows execution type, device, OS, browser, runtime session

## Tests
Unit: attestation validation matrix (each of the 7 checks failing → BLOCKED). E2E: forced attestation failure → BLOCKED result.
