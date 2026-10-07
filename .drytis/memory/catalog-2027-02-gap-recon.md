# Catalog 2027.02.0 gap recon + execution chain honesty (verified)

Catalog (server/environmentCatalog.js, v2027.02.0, 767 lines): all requested iPhones 11–17 Pro Max PRESENT; iPads only as generational names (iPad (5th–11th Gen), Air (3rd–7th), mini (5th–7th), Pro 11 (1st–5th), Pro 12.9 (3rd–6th), Pro 13 (M4)); macOS = 18 hardware models spanning High Sierra→Tahoe; all requested Android models present (manufacturer field + brand-prefixed runtimeDeviceName, same android platform); Windows form factors + 7 Surface models exist; BROWSER_VERSIONS per family: chrome 140–156, firefox 141–158, edge 140–156, opera 122–137, brave 136–140, ddg 1–3 (depth does NOT differ per platform).

Execution honesty findings:
- browserstackProvider.js resolves mode 'environment' only with BROWSERSTACK_USERNAME+ACCESS_KEY (default ABSENT → everything runs local Chromium 'emulated', label admits it).
- qaTools.runtimeIntegrity = presence checks, NO comparison of runtimeFacts vs requested selection. attestationFor pulls device/os/browser/browser_version from environmentSnapshot (catalog), not runtime.
- runtimeFacts (browserBridge L561/634 probe) = userAgent/viewport/DPR/maxTouchPoints/platform, read from page but never diffed.
- deviceRuntime manager: board availability is catalog-seeded + local in-process claims, not real farm; browserstackRuntimeProvider.create_session returns sessionId:null (no real reservation). nullRealDeviceProvider = default for real hardware.
- Evidence: ephemeral SSE JPEG frames only (captureFrame); artifactStore sidecar carries runtimeFacts.executionLevel + attestation; BrowserStack artifact capture methods are stubs.
- Tests covering honesty: attestation.test.js, qaTools.test.js, browserBridgeEnvironment.test.js, runtimeFacts.integration.test.js, deviceRuntime/deviceRuntime.test.js, scripts/validate-matrix.mjs.
Gap list to build: real device reservation, creds in runtime path, identity comparison, runtime-sourced attestation, REAL_DEVICE provider wired, persisted evidence, real WebKit for Safari targets.