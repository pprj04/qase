# RT5 #14757 — DONE (2026-10-06)

Closed via move_ticket (update_ticket still rejects RT ids — same stale-board tool bug).

## Shipped
1. **Video evidence** (browserBridge.js): context-level recordVideo (Chromium only) at newContext; per-session temp dir os.tmpdir()/qase-video-<sessionId>; collectSessionVideo harvests the largest finalized webm at suspend() (close finalizes); bridge.setVideoSink wired in localServices.saveEvidenceArtifact → artifactStore.save type 'video' (webm already mapped). Honest states: ACTIVE/SAVED/FAILED/UNSUPPORTED (newContext rejection retries video-less). Integration test asserts real EBML magic bytes.
2. **artifactStore root bug FIXED** (pre-existing, latent): injected `root` option was silently ignored — module directoryFor always used cwd default; all stores shared .qase/artifacts/<sessionId> and tests passed only via cross-run accumulation (test file passes root as a FACTORY FUNCTION, so per-call evaluation created a new mkdtemp dir per op). Fix: root resolved ONCE per store creation; directoryFor is per-store closure.
3. **Runtime-identity stamping**: artifact sidecars now prefer runtimeFacts.brandedBinary brand/detectedVersion over catalog labels; new launchedEngine + observedUserAgent sidecar fields; executionMetadataFor returns launchedEngineId. agent.js persists launchedEngineId/brandedBinary into session.runtimeFacts.
4. **Coverage-state vocabulary** (matrixCoverage.js): COVERAGE_STATES + coverageStateOf — 8 required distinct states (Tested-Passed/Tested-Failed/Environment Unavailable/Browser Unavailable/Execution Failed/Device Offline/Not Selected/Not Supported + Not Run/Running). UNAVAILABLE splits by recorded reason (health check → ENVIRONMENT first; browser/binary → BROWSER; offline patterns → DEVICE_OFFLINE); NOT_RUN splits deselected vs not-run; unknown status → EXECUTION_FAILED never PASSED. execution.states + stateCounts arrays; gap rows carry coverageState/coverageStateLabel; report.md renders 'Coverage states' section; deviceMatrixView gap table shows the label.
5. **Findings context**: matrixOrchestrator findings carry full environment block (profileId, device, OS, versions, runtimeFacts executionLevel/provider, launchedEngine, UA, viewport, brandedBinary, sessionId, matrixRunId); renderFinding adds a .finding-env line (textContent only) with matching styles.css entry — Findings UI structure unchanged.

## Tests
matrixCoverage.states.test.js 4 (mapping/no-collapse/per-state/artifact isolation w/ runtime-identity stamp), matrixOrchestrator.isolation.test.js 1 (mid-bulk crash of one env leaves others intact; independent sessions; coverageState mapping), browserBridge.video.integration.test.js 1 (real EBML webm), plus all regression suites green (~160 tests). Browser suite runner updated with video test.

## Verification
Reviewer round-1 PASS 4/4 (4 WARNs — 3 fixed, video-on-suspend-only accepted edge), round-2 PASS all fixes verified. infra_verifier PASS all 7. Tester PASS 5/5 (fixture index, meeting fixture identical, app shell clean, Device matrix dialog opens/closes 5 tabs, console clean — perf-panel overlay did not interfere this session).

## Standing
NIHARIKA branch: ALL NI+RT work UNCOMMITTED (5+ commits ahead of origin/NIHARIKA pre-RT1; RT1–RT5 uncommitted since) — MUST publish before any redeploy. Carried WARNs: stale QASE_BROWSER_ALLOWED_PRIVATE_HOSTS entry (platform-side), zombie count ~2.5k (drytis-init reap issue, trending up).

NEXT: RT6 #14758 (automatic matrix execution, validation & published gap report) — last ticket.