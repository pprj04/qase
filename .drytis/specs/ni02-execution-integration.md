# NI02 Phase 2 · Execution integration: real per-profile execution & artifacts

## Goal
Each matrix item actually executes the shared workflow under its profile's emulation/runtime and captures artifacts. Extends `server/browserBridge.js`, `server/browserstackProvider.js`, `server/deviceRuntime/`.

## Work
1. Matrix orchestrator drives the existing execution path per item: environment snapshot → `resolveExecution()` → mode default/environment/emulated/blocked → local Playwright context with `environmentEmulationOptions()` (viewport/DPR/isMobile/hasTouch) or BrowserStack CDP when REAL_DEVICE/VIRTUAL_DEVICE with creds.
2. iPad/tablet profiles: ensure emulation uses tablet viewports/touch (verify `ipados` platform emulation hints; add if missing) and they never reuse phone profiles.
3. Windows/macOS profiles: desktop viewports per resolution profile; engine per `engineForBrowser()`; Opera/Brave as Chromium engine-equivalent clearly labeled.
4. Artifacts: per-item screenshot on completion/failure (existing capture path), durationMs recorded, runtimeFacts (UA/viewport/DPR probed from page — existing browserBridge 580–589) stored in item record; video only where provider supports.
5. **Known-defect fixtures** (new module `server/defectFixtures.js` extending the `/demo` fixture system): a small registry of representative known defects, each defined as { id, title, description, expectedAffectedProfiles (category/device predicate), repro workflow, verification (how the engine checks whether the defect reproduces) }. Example fixture: "Login button overlaps keyboard" expected on touch devices (iPhone/Android phone/iPad). Fixtures mount demo pages under `/demo/defects/<id>/…` reproducing the defect on affected form factors via viewport/touch emulation. The matrix engine runs fixture verification per profile and records reproduced=TRUE/FALSE/NOT-VERIFIED with evidence — never fabricated.
6. Findings: per-profile findings flow through existing `qa_findings` + run link; matrix item stores finding refs.

## Tests
- Fixture test: run fixture "login-button-overlaps-keyboard" against iPhone profile (touch) → reproduced=TRUE; against Windows desktop → reproduced=FALSE. 
- Artifact test: failed item has screenshot + error + duration.
- Honest statuses: item with no BrowserStack creds and executionLevel=REAL_DEVICE → BLOCKED/UNAVAILABLE with reason, no artifacts claimed.

## Edge cases
- Emulated Safari on Windows (impossible) must not be offered (compatibility layer from NI01 Phase 2).
- Long workflows across many profiles: item timeout produces ERROR with reason, other items continue.

## Acceptance criteria (running app)
- [ ] A failed profile shows its actual error and a screenshot captured from that profile's viewport.
- [ ] Known-defect fixture reports reproduced on touch profiles and not on desktop, with evidence.
- [ ] REAL DEVICE requests without provider creds show BLOCKED/UNAVAILABLE, never PASS.
