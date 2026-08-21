# BUILD 18.4 REPORT — Before / After Evidence Comparison

Build: 18.4 · Status: PASS · Date: 2026-08-20 · Scope: user-facing evidence-comparison layer, frontend only.

## Objective

Make the real evidence that BUILD 18.3's validation executor produces
understandable and useful inside the Qase UI: structured BEFORE/AFTER
rendering, viewable screenshots, deterministic comparison flags, richer
validation history — without touching the execution or status engines.

## 1. Inspection findings

| Area | State before 18.4 |
|---|---|
| `server/fixValidation.js` | Stores everything needed: immutable `originalFinding` snapshot, `evidence.before/after` rows (kind, ts, title, description, `evidenceNodeId`, `artifactPath` for failure screenshots), `attempts[]` (per-attempt assertions with type/passed/actual/expected, steps, durationMs, error, sufficiency, missingEvidence), `comparison.verdicts`, `environmentDeltas`, `timings`, `reviewTrail`. **No backend change required.** |
| `server/replay.js` | Persists failure screenshots as JPEG to `.qase/artifacts/<uuid>/step-assert-N.jpeg`; `artifactPath` = `<dir>/<file>` maps 1:1 to `GET /api/artifacts/:runId/:filename` (public route, same-origin cookie auth, path-traversal-guarded — verified serving 200 / 22,296 bytes). 234 runs / 519 screenshot rows on disk. |
| `public/bugs.js` Compare view | EXISTED+PARTIAL — 4 raw flag rows, no BEFORE/AFTER panels, no screenshots. |
| `public/bugs.js` View Original / View Validation | EXISTED+BROKEN (as UX) — raw `<pre>` JSON dumps; the exact "current limitation from BUILD 18.3". |
| `public/bugs.js` History view | EXISTED+PARTIAL — run rows showed id · status · reason · conf; no date, duration, evidence availability; not clickable. |
| Drawer Fix Validation section | EXISTED+WORKING (18.2) — badge/confidence/attempts/flags/regressions/buttons/polling. No evidence blocks, no screenshots. |

## 2. Existing functionality kept

- Validation engine + status engine untouched (18.1/18.3 invariant).
- All seven 18.2 actions, polling VALIDATING indicator, error-vs-empty distinction, review guards (409s) unchanged.
- Drawer compact summary (badge · confidence · attempts · Before/After flags · regressions) unchanged.

## 3. Missing functionality → implemented

1. **Structured render helpers** (`fxNewEl`, `fmtTs`, `fmtDur`, `renderFxKv`): key/value panels replace all raw JSON.
2. **`renderFxOriginalBlock`** (BEFORE): Title, Expected, Actual, Severity·priority, URL, Environment, Mission/workflow, Reproduced n/N, reproduction steps (ordered list), linked-evidence count. Collapsible `<details>`; immutable-snapshot provenance in the summary label.
3. **`renderFxAfterBlock`** (AFTER): run ID, executed time, result + why, validation confidence ("new measurement"), observed vs expected, URL validated, environment, console/network, durations (total/attempts), environment deltas (⚠ warning), regressions (verified/suspected), review trail.
4. **`renderFxAttempts`**: per-attempt cards — result chip (✓ pass / ✕ original failure reproduced / ✕ failed / ⚠ not executed), duration, timestamp, **assertion table** (Assertion | Result | Expected | Observed, failing row tinted), step chain (✓ click → ✕ fill → …), errors, missing-evidence list.
5. **Screenshots**: `renderFxShotStrip` — thumbnails (lazy-loaded, BEFORE=amber / AFTER=cyan tags), click → `fx-image-modal` overlay with naturalWidth 1440 images, meta line (phase · timestamp · run ID). **Aggregates artifacts from ALL runs of the finding** (latest run first); older-run thumbnails carry a gray "older run" tag; "+N more in History" overflow cue. Broken-artifact → graceful "screenshot unavailable" state, never a broken img icon. "Not captured for this run." empty state.
6. **Compare view rebuilt**: titled by run ID, four deterministic flags with **literal yes/no values** and good/bad **coloring** (the two failure flags color-inverted — "✕ no" green, "✓ yes" red), then ORIGINAL + AFTER panels + screenshots.
7. **View Original / View Validation**: structured panels (ORIGINAL / AFTER+ATTEMPTS+screenshots), no JSON dumps; explicit "No validation run recorded" / "snapshot not retained" empty states.
8. **History view**: rows now id · date · status · conf% · attempts · duration · evidence-count · reason; **clicking a run expands its structured evidence inline**.
9. **CSS** (~120 lines appended): shot strip/overlay, BEFORE/AFTER blocks, kv panels (amber/cyan labels), attempt cards, assertion table, responsive <720px stacking.

## 4. Files changed

| File | Change |
|---|---|
| `public/bugs.js` | +~330 lines: 18.4 helper + renderer block; rewritten modal views (runs/compare/original/validation); drawer evidence blocks + `allRuns` wiring. Zero server imports touched. |
| `public/styles.css` | +~125 lines (18.4 section, incl. mobile breakpoint). |

No backend, engine, store, route, or test file was modified.

## 5. Evidence flow (unchanged backend, new presentation)

```
replay.js (Playwright) → .qase/artifacts/<uuid>/step-assert-N.jpeg
                        → res.screenshots[].artifactPath
validationExecutorCore.recordEvidence() → evidence-graph node (metadata.validationId/findingId/phase/artifactPath)
                                        → run.evidence.before/after[] rows (artifactPath)
GET /api/v1/findings/:id/validation → {latest, history}
bugs.js renderFx*() → <img src="/api/artifacts/<dir>/<file>"> (cross-origin-resource-policy OK)
```

## 6. Browser verification (tester sub-agent, preview URL)

**Round 1** (6 fixture classes): 9 PASS / 2 FAIL / 1 INCONCLUSIVE + 2 BLOCKED-on-missing-findings.
The two FAILs were real defects in my first cut, both fixed:

- **FIX A (correctness)** — Compare modal rendered the *goodness* instead of the *value*: every flag showed "✓ yes". Now glyph/word = literal flag value; color = good/bad with inversion for `originalFailureReproduced` / `relatedFailuresIntroduced`.
- **FIX B (aggregation)** — drawer strip showed (0)/"Not captured" when the latest run passed but older runs held failure screenshots. Now aggregates across the finding's runs.

**Round 2** (ground truth taken from `/validation` API verdicts before UI checks):

| Check | Result |
|---|---|
| 92d9bad6 Compare rows = true/true/false/false → "✓ yes/✓ yes/✕ no/✕ no" (✕ no green) | PASS |
| 356c3d00 strip (4) with "older run" tags + working 1440px overlay | PASS |
| 356c3d00 Compare literal values | PASS |
| e7581070 REGRESSED: relatedFailuresIntroduced=true → "✓ yes" colored RED + regressions list intact | PASS |
| Console: only the 3 known background 404s, zero new errors | PASS |

**RESULT: PASS (4/4)** — plus round-1 passes: STILL_BROKEN drawer, workflow finding (18.2 bug class) renders structured ORIGINAL with 4 linked evidence nodes, "Not captured" empty states, History inline expansion, screenshot overlay.

### Data-integrity verification (STEP 8)

- Original evidence immutable: snapshot served from `run.originalFinding`; engine never writes back to it — verified across all inspected runs (B183 runs 1–3 keep their original 9906 URLs).
- Validation evidence belongs to its run: `evidenceNodeId` metadata carries `validationId` + `findingId` + `phase`.
- Screenshots map to the correct validation: artifactPath per run, thumbnail meta shows producing run ID.
- History maps to the correct finding; Compare uses `data.latest` (correct newest run).
- Missing/malformed evidence: every renderer is null-guarded; workflow-array evidence normalized since 18.2; ff2f311e-class (no-evidence) runs render "Not captured".

## 7. Tests

| Suite | Result |
|---|---|
| phase18-unit | 38/38 |
| phase18-api | 13/13 |
| phase18-e2e | 10/10 |
| Full regression (46 suites) | **1,075 pass / 0 fail — ALL CLEAN** |

No tests deleted or weakened. No new automated UI tests (no static-UI test convention exists in this repo; browser verification via tester sub-agent per house pattern).

## 8. Acceptance criteria — 20/20

- [x] Existing validation engine remains unchanged (zero server edits).
- [x] Existing fix-status engine remains authoritative (badges still read engine-written `fixStatus`).
- [x] BEFORE evidence visible (structured ORIGINAL panel: expected/actual/URL/env/steps/reproduced).
- [x] AFTER evidence visible (AFTER panel + attempt cards + screenshots).
- [x] Screenshots viewable (strip → overlay; BEFORE/AFTER labels; producing run ID; older-run tag).
- [x] Expected vs observed understandable (kv rows + assertion table columns).
- [x] Assertion results understandable (✓/✕ per assertion with expected/observed values).
- [x] Console/network evidence visible when available ("no errors / no failures" from comparison.after).
- [x] Missing evidence has a safe empty state ("Not captured for this run." / "screenshot unavailable").
- [x] Evidence cannot crash the finding drawer (all renderers defensive; round-1 workflow + no-evidence findings verified).
- [x] Validation history functional (richer rows + inline expansion).
- [x] Compare uses the correct run (data.latest; run ID in title).
- [x] Workflow findings work (wf_user_login — 18.2 bug class — PASS).
- [x] STILL_BROKEN works (356c3d00).
- [x] VERIFIED_FIXED works (92d9bad6).
- [x] REGRESSED works (e7581070 incl. inverted-color case).
- [x] Responsive UI works (<720px stacking breakpoint; overflow-safe word-break rules).
- [x] Loading/error states exist (18.2 states retained; explicit per-view empty/error messages).
- [x] Existing Phase 18 behavior intact (regression ALL CLEAN).
- [x] Full regression passes (46/46 suites).

## 9. Known limitations

1. **Orphaned validation runs**: 119 of 140 findingIds referenced by stored runs no longer exist in the findings store (test fixtures pruned across benchmark reruns). They are unreachable from the UI (finding is the entry point) but still stored; GET /api/v1/fix-validations lists them. Not a 18.4 defect — data hygiene for a future build.
2. **Badge vs latest run**: a finding's `fixStatus` badge can trail its newest run (356c3d00 badge STILL_BROKEN, newest run VERIFIED_FIXED) because 18.1's write-back only updates the finding when the engine's trust gate passes. The Compare modal shows the latest run's flags, so badge and flags can disagree. This is engine-owned behavior (18.1), deliberately not changed in 18.4; the AFTER panel's "Why" and the run title make the actual run status visible. Candidate for a small UX note in a future build — out of scope here.
3. Screenshots exist only for failing attempts (engine captures failure evidence; passes assert behavior + console/network). Pass-only runs correctly show "Not captured".
4. Mobile/panel duplication: the six button labels are shared across drawer/modal contexts as in 18.2.

## 10. Future work documented (NOT implemented)

BrowserStack/device execution; mobile-device testing; compliance; regression monitoring; OpenAPI; MCP; Founder Mode; Studio integration; benchmark redesign; orphaned-run cleanup; badge-vs-latest-run reconciliation UX.

## Regression result

`SUITES=46 TOTAL_PASS=1075 TOTAL_FAIL=0 TOTAL_CANCEL=0 — ALL CLEAN` (identical to Phase 17 baseline counts; no new failures, no weakened tests).

## Final verdict

**PASS.** Structured evidence comparison shipped, frontend-only, engines untouched, both round-1 defects root-caused and fixed with round-2 ground-truth verification, full regression clean.
