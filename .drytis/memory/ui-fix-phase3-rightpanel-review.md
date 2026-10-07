# Review: ticket #13976 — UI Fix Phase 3 (right panel hierarchy, runtime status model, sidebar)

Reviewed on NIHARIKA working tree (uncommitted, on top of merge 611d41c). Overall **PASS** with WARNs.

## What the diff actually contains (Phase 3 scope)
- index.html: sidebar footer `#open-device-matrix` button removed; `open-device-matrix` button re-hosted INSIDE the #settings dialog (Device management field); `#run-list` got `tabindex="-1"` for the Results focus.
- app.js: Results quick action → `refreshRuns()` + focus #run-list + toast 'Run history refreshed…' (replaces the old `.panel-foot .foot-btn` phantom-click); `globalThis.__qaseActiveSelection = () => activeTestEnvStore.get()` accessor; `ldv-change-device`/`ldv-choose-device` → the ONE picker; `ldv-device-details` → clicks Settings-hosted `#open-device-matrix`.
- deviceDrawer.js `paintChip`: reads store selection via `__qaseActiveSelection` first (fallbacks: drawer defaultEnvId → legacy localStorage key); chip exec label now `executionLevelRequested ?? runtimeAttestedLevel ?? null` (isRealDevice no longer drives the chip badge).
- The right-panel env card / ldv header / activeRuntimeEnvironment view-model came in via the PUSHKAR merge (611d41c) — verified as working per spec.

## Key findings
- AC "card shows the run's environment snapshot on session switch" is **deliberately diverged**: `renderEnvironmentCard` (app.js:725-768) shows the run's resolved view ONLY for active statuses ['running','connected','connecting','reserving']; otherwise the store selection. Documented in-code; tester flagged T-D as design-ambiguous; leader confirmed design decision. Treated as WARN, not FAIL.
- Runtime vocabulary: 8 of 10 spec words implemented (no BLOCKED, no RELEASED in runtimeStatusFor / RUNTIME_STATUSES). WARN.
- Spec change-item 1 said [Details] opens an inline collapsible capabilities panel; implementation opens the Device Matrix instead. WARN (deviation).
- Dead code: `openEnvironments()` (app.js:4105) has zero callers and the `#environments` admin dialog (index.html:384) is now unreachable — spec item 4 said remove Environments as primary item, but the dialog+JS remain as dead UI. WARN.

## Tests
- npm test: 829 tests / 820 pass / 9 skip / 0 fail (up from 820 total: +6 rightPanelContract, +3 tabWorkspace).
- node --test public/*.test.js: 89/89 (was 80).
- New contract tests are regex/source-level only (read files, assert patterns) — no behavioral test of the card gating or vocabulary mapping.

## Integrity/security
- index.html: 14/14 dialogs, 3 script tags once each, single </body></html>, no duplicate ids. Device Matrix reachable only via Settings `#open-device-matrix` (single id, single listener via deviceMatrixView navButton) plus exec-fallback paths that call `deviceMatrix?.open()` programmatically.
- No secrets/URLs in diff; deviceDrawer textContent-only changes.

## Outstanding WARNs
1. Everything still uncommitted (7 modified + 3 untracked files incl. stray `right-panel-1024.png` screenshot at repo root — should not be committed).
2. Vocabulary missing BLOCKED/RELEASED.
3. [Details] opens Device Matrix, not inline capabilities.
4. Dead `openEnvironments()` + unreachable #environments dialog.
5. Card gating on active-run statuses deviates from spec AC (documented decision).
