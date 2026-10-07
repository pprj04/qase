# Phase 5 · Validation & regression sweep

Goal: prove the 12-point validation list from the request against the running app.

## Checks (scripted where possible — extend scripts/test-acceptance.mjs + validate-matrix.mjs)
1. All OS categories display in the rail (iOS/Android/Windows/Mac + Favorites/Recent).
2. Spot-assert presence of: iPhone 17 Pro Max, iPhone SE (3rd gen), iPhone 7, iPad Pro 13 (M4), iPad Air (7th gen), Galaxy Tab S10, Galaxy M55, Pixel Tablet, Pixel 10 Pro, Zenfone 11, Xperia 1 VI, POCO F6, Windows 7 Desktop, MacBook Pro 16 (M4), Mac Studio.
3. Windows versions 7–11 selectable; macOS High Sierra→Tahoe reachable via supported hardware.
4. All seven browsers appear across platforms; multiple versions selectable.
5. Compatibility: Safari never on Android/Windows; per-device OS ranges within factual bounds (unit fixtures).
6. Execution honesty: no REAL DEVICE label without attested provider level; default catalog shows SIMULATED/VIRTUAL MACHINE truthfully.
7. Search across device/manufacturer/OS/OS version/browser/browser version (acceptance probe).
8. Favorites add/remove/recents persist (reload test).
9. Existing workflows unbroken: start QA run, SQA, bulk runs, report export — full `test:acceptance` suite green.
10. No duplicate device entries; stable IDs (validate-matrix + unit).
11. Layout: picker matches reference (rail + columns + search + stars); `test:ui` PASS at all six resolutions; no clipping (dialog fits viewport).
12. No fake data: audit that every availability/execution badge traces to catalog or provider attestation (code-path review + test asserting no hardcoded availability).

## Definition of done
- npm test, public tests, test:ui, test:acceptance, validate-matrix all green.
- Reviewer pass on the ticket's review brief scenarios.
