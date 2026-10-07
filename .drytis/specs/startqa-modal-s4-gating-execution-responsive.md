# Phase S4 · Start gating, execution honesty, responsive verification

## Goal
Start enabled iff valid URL + (device scope chosen or matrix selection non-empty) + ≥1 selected
browser. Every selected configuration executes via /api/qa-matrix-runs; results carry real
device/OS/browser/version/execution-type; no silent reduction. Modal usable on mobile/tablet/desktop.

## Files
- `public/app.js` — `syncQaSubmitState`: also disable when scoped selection is empty; enable the
  moment a device with ≥1 AVAILABLE browser is picked (no manual browser ticking needed).
- No server change expected — `/api/qa-matrix-runs` already fans out one item per configuration
  (server/app.js:864–934, orchestrator). Verify with a small run (2–3 configs) that results carry
  execution_type/provider per item.
- `public/styles.css` — only if a real overflow/clipping defect is found at ≤980px / ~375px width;
  keep existing design language.

## Acceptance criteria (running app)
- [ ] With URL + device selected and zero manual browser clicks, Start is ENABLED and starts a run.
- [ ] Start disabled when: URL empty/invalid, no device & no selections, or all compatible browsers deselected.
- [ ] A small run produces one result per selected device–OS–browser; each shows its actual device, OS, browser, version and execution type (emulator/simulator/browser emulation), never "real" for a local emulated run.
- [ ] A deselected browser produces no run item for it (and appears as skipped/not-planned, not passed).
- [ ] Modal renders correctly at desktop, ~768px and ~375px: no horizontal scroll, no hidden controls.

## Tests
- qaConfigMatrix: sync gating unit for scoped empty selection.
- E2E manual journey per acceptance list; responsive spot-check at 375/768/1280.

## Edge cases
- Device with only DuckDuckGo-compatible-but-unavailable rows → Start disabled with honest reason.
- Session expiry mid-configuration → existing #15123 error+retry state covers it.
