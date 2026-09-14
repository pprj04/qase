# #10746 Reduce repeated browser attempts that slow QA runs

Observed: latest saved run made 145 calls over ~22.5 minutes, repeatedly locating pricing controls. SDK snapshots enumerate all visible DOM nodes then truncate to 150 (max 500), allowing layout wrappers to crowd controls out. Existing bridge repairs selectors but cannot recover omitted controls.

- [x] Snapshot prioritizes visible interactive controls across the document, bounded to requested limit, rather than truncating before selection.
- [x] Retain SDK-compatible eN indices and unique selectors; preserve noninteractive context when space permits.
- [x] Support data-testid, data-test and data-cy selectors accurately.
- [x] Disclose omitted element counts and provide concise actionable retry guidance without declaring untested controls passed.
- [x] No weakening navigation policy, validation, or completion gates; no provider/model changes.
- [x] Unit and real-browser regression with >500 layout nodes demonstrates late control available and clickable in one snapshot/action.
- [x] Infrastructure, reviewer and tester pass. Preserve active customer runs; no forced restart mid-run.

Verification compares control discovery before/after deterministically; overall model-run speed is not guaranteed or inferred from fixtures.

Validation: unit and real-browser red → green; desktop/mobile late control e561 found/clicked with one snapshot/action; unique selector regression and omission counts pass. Full suite: 463 passed, 6 skipped. Independent review passed. Live preview 200/no browser errors. Activation waits for active customer run to finish; no total-run speed claim.

Revalidation 2026-09-14: 463 tests passed, 6 skipped; independent reviewer passed. Real SDK/Chromium desktop and iPhone fixture passed with one snapshot/action (e561; 564 eligible elements, 20 returned, 544 omitted). Live desktop/mobile smoke returned HTTP 200 with no page errors. Managed production services and Caddy root proxy are healthy. The app process started after the bridge change, so activation is complete without a restart. Central environment registration could not be rechecked because the Drytis project-details tool reports missing API_BASE_URL; this ticket changes no environment configuration. No overall QA-run speed guarantee is inferred from the fixture.
