# Ticket #14650 review — NI02 Phase 2 fixture wiring (2026-10-06)

## Verdict: FAIL — one critical integration defect (fixture verify probe dropped)

### CRITICAL: hooks.verifyFixtures receives stripped fixtures → every live fixtureVerdicts entry is NOT_VERIFIED
`listDefectFixtures()` returns `{id,title,description,expectedSummary}` ONLY (no `verify`, no
`affects`). app.js:706 wires `verifyFixtures: listDefectFixtures()` and passes each entry to
`verifyFixtureAgainstProfile({fixture,...})`. Runner builds `new Function("return
((undefined)())")` → probe TypeError → NOT_VERIFIED; `fixtureExpectation` returns
'NOT_VERIFIED' (affects stripped). EMPIRICALLY CONFIRMED with a real launch against the live
app: reproduced=NOT_VERIFIED, error "page.evaluate: TypeError: (undefined) is not a function".
So in a real matrix run every fixture verdict is NOT_VERIFIED, never TRUE/FALSE — acceptance
criterion 2 fails in the running app. Honesty preserved (no fabrication) but the feature is inert.
Root cause of test blindness: matrixOrchestrator.test.js:127 supplies its OWN fake
`hooks.verifyFixtures` objects (with inline `affects` + a canned runner) — never exercises
app.js's real wiring. Fix direction: pass full registry fixtures (`getDefectFixture`) or have
the runner re-resolve by id.

### Verified good
- Runner + fixtures themselves are sound (control run with the full registry fixture:
  webkit/iPhone TRUE {buttonBottom:866,trayTop:694}, desktop chromium FALSE {trayTop:0}).
- defectFixtures.test.js 5/5 real-execution (iPhone 17 Pro + iPad Pro 12.9 TRUE, Windows
  desktop FALSE; wide-table phone TRUE / tablet 1024px FALSE; NOT_VERIFIED on bad inputs).
- Tablet 1024 width is intentionally ≥ the 1023px layout flip (1024px-deadzone-fix.md) —
  no dead-zone interference.
- mountDefectFixtures BEFORE mountDemoSite (app.js:239) — demo router catch-all would
  swallow /demo/defects/*; order verified, both pages serve 200.
- Orchestrator: fixtureVerdicts after outcome; executionLevel/provider prefer
  outcome.runtimeFacts (observed) over requested; runtimeFacts whitelisted fields stored.
  BLOCKED on awaiting_input and RUNTIME_UNAVAILABLE preserved. FULL_URL is unrelated
  playwright constant; agent path uses page.goto(extractUrl) — no SSRF regression.
- Migration 034 additive jsonb (fixture_verdicts NOT NULL DEFAULT '[]', runtime_facts
  nullable); pinned migrations.test currentVersion 34, order through 034.
- matrixRunRepository: fixture_verdicts/runtime_facts in ITEM_COLUMNS, insert + updateItem
  maps, rowToItem; JSON.stringify consistent with findings/artifact_refs; updateItem
  runtimeFacts null-aware. Real SQL though (not just fakes) not re-tested against live PG.
- Suites: targeted 31/31; full npm test 1238 / 0 fail / 20 skipped (matches claim).
- procmgr all RUNNING; /demo/defects 200.

### WARNs (carried / new)
- postgresServices has NO artifacts service (0 grep hits) → collectArtifacts degrades to []
  in postgres mode; artifactRefs empty there (round-4 #14649 WARN, unresolved).
- No live end-to-end matrix run exercising the new fields exists on disk (latest runs
  predate wiring; no item has fixtureVerdicts/runtimeFacts/artifactRefs populated).
- FAILED-item artifactRefs (screenshot from profile viewport) only asserted by code read —
  no test asserts artifactRefs on a FAILED item (spec Tests bullet 2).
- Fixture runner engine: engineForBrowser returns null for e.g. 'edge' on... actually null
  browserCode → falls back 'chromium' via `?? 'chromium''; null launcher branch likely
  unreachable. Minor.
- STILL UNCOMMITTED (8th consecutive review).
