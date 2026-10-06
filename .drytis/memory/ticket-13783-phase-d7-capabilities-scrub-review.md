# Ticket #13783 — Phase D7 (capability-verified media + provider scrub) — Review: PASS

Spec: .drytis/specs/device-d7-capabilities-scrub.md (3 acceptance items).

## Acceptance 1 — media verifies actual stream state: PASS (mic-scoped by design)
- probeMicrophone (browserMedia.js:79–132): 5s Promise.race timeout → outcome 'rejected'; real RMS over analyser samples with threshold rms > 0.0001 → signalDetected; finally stops tracks and asserts tracksStopped (every readyState==='ended'); never reports success from a button click.
- browser_media tool gates whitelisted params (browserTools.js:29–49); bridge (browserBridge.js:689–712) requires syntheticMedia, requires non-prompt permission before probe, includes observed requests in result; agent.js:1209 surfaces permission + probe + last application request.
- Capability gating via attestation intact: qaTools.js runtimeIntegrity — REAL_DEVICE requires att.device_id && att.capabilities_verified; capabilities_verified null for non-REAL levels.
- Integration coverage: browserMedia.integration.test.js (skipped unless QASE_RUN_BROWSER_TESTS=1) — denied capture, signal, mute/track state transitions, cleanup, suspend/restore.

## Acceptance 2 — permission outcomes as evidence: PASS
installMediaObserver wraps getUserMedia recording outcome granted/rejected + per-track {kind, enabled, muted, readyState}; inspectMedia returns permission state (permissions.query) + secureContext + captureSupported + recorded requests; committed via runStore.commit 'browser_media'.

## Acceptance 3 — zero provider names user-facing: PASS
- Sweep re-run by hand: 0 mixed-case BrowserStack in the 7 user-facing files (only comment lines + raw-key lines remain, which the test deliberately skips).
- Live preview HTML + app.js served: 0 browserstack mentions (grep -i) except raw-key comparison lines in app.js (658, 5903, 5914) — none render the provider name.
- index.html: environments subtitle, qa-advanced label + option all neutralized. app.js pill.title → 'remote environment runtime', env table 'Remote runtime', detail falls back browserstackCapabilities ?? runtimeCapabilities. report.js/reportPdf.js map browserstack→'remote environment runtime', local→'local runtime' in environmentLine + Execution rows (both files, 2 sites each).
- providerScrub.test.js: 2/2 green — line-level sweep (comment + raw-key skip rules documented) + label-mapping pin in both report files.
- qaTools.test.js + reportPdf.test.js: 21/21 green (2 assertions flipped from \(browserstack\) to \(remote environment runtime\), correctly pinning the new behavior).
- npm test: 1156/1136/0/20 exact match (up 2 from #13782's 1154).
- procmgr all RUNNING; localhost + preview 200.

## WARNs (non-blocking)
1. E2E camera/screen-share probes don't exist as tools — browser_media is mic-scoped by design; camera/screenShare capability truth exposed via deviceDrawer/deviceRuntimeProfiles per-platform maps (honest 'limited'/'unavailable' labels). Known limitation, not a regression.
2. server/deviceRuntime/browserstackRuntimeProvider.js still surfaces 'BrowserStack credentials not configured' in unavailableReason and 'BrowserStack remote device' fallback name — admin/diagnostic surface, not covered by the sweep (spec's grep target was UI + report text). Same class of residual: browserstackProvider.js comments etc. Spec says internals stay.
3. Spec change-item "rename provider keys to qase_remote_runtime" NOT done — raw key 'browserstack' deliberately kept (API contract unchanged; ticket context documents keeping keys functional). API responses still carry executionProvider:'browserstack' — literal reading of acceptance 3 ("API responses") is not met; agreed interpretation is user-facing TEXT only.
4. Media integration tests are skip-by-default (QASE_RUN_BROWSER_TESTS=1); the 20 suite skips include them.
5. Carried: uncommitted working tree stacked across tickets.
