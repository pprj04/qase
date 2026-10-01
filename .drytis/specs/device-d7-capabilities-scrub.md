# Phase D7 — Capability Testing (Camera / Mic / Screen Share) & Provider Scrub

## Goal
Media tests exercise real device capabilities; QASE presents its own runtime architecture.

## Changes
- Camera test flow: request permission → open camera → verify stream active → capture evidence → verify permission state. Mic: request permission → start capture → verify audio input → evidence. Screen share: request → start → verify sharing state → stop → verify cleared. Each step gated on the runtime's *actual* reported capability (via attestation capabilities_verified), not the profile flag. Pass only when the stream/capture state is verified, not when a button was clicked.
- Grant needed permissions in the browser context per session (currently only mic via CDP); record permission outcomes as evidence.
- Scrub all third-party provider references (BrowserStack terminology) from UI, API responses, tooltips, logs, error messages, settings, help; rename provider keys to QASE-neutral names (e.g. `execution_provider: 'qase_remote_runtime'`), keep env-var names functional but absent from user-facing text.

## Files
server/browserMedia.js, server/agent.js (media test steps), server/browserstackProvider.js → neutral naming, public capability result views, grep-sweep across public/ and server/.

## Acceptance
- [ ] Camera/mic/screen-share tests verify actual stream/capture state and fail when the stream never becomes active
- [ ] Permission state is captured as evidence for each media test
- [ ] Zero third-party provider names in UI text, API responses, tooltips, and error messages (grep-verified)

## Tests
Unit: media test step gating. E2E: camera test on emulated context completes with stream-verified evidence; grep sweep returns no provider names.
