# Browser checklist audit & real-time verification (#15092, 2026-10-06)

Found + fixed one REAL bug: family-checkbox toggles crashed the renderer tab.
Cause: app.js family change-handler looped over ~8k configurations calling
store.deselect()/reselect() one at a time — each call persisted the whole
deselection set to localStorage synchronously (~8k JSON.stringify of a growing
array → renderer OOM/crash).
Fix: added deselectMany()/reselectMany() to createDeselectionStore
(public/qaConfigMatrix.js) — single persist per bulk toggle; family handler in
public/app.js now uses them. Regression test added in
public/qaConfigMatrix.test.js (#15092 bulk-store test). Tester re-verified:
6 family bulk toggles, 0 crashes, counts exact.

Real-time verification (all CONFIRMED live, no caching issues):
- Dialog fetches /api/qa-configurations fresh on EVERY open (loadQaMatrixCatalog
  aborts prior fetch, reloads; Cache-Control: no-store server-side).
- Browser availability is live: server probes local binaries at boot AND every
  5 min (server/index.js setInterval); /api/qa-configurations resolves
  availability from the current registry snapshot per request. Observed
  flip-flop on a thread-exhausted host proves it's genuinely dynamic.
- Device tree: search (150ms debounce) and platform/manufacturer/OS/orientation
  filters trigger immediate re-render + server-windowed reload (Load more).
- DuckDuckGo: renders disabled with honest reason (mobile-only, no Linux build,
  no automation channel).

Known caveats (by design, not bugs):
- Summary line stays GLOBAL when filters are active (family rows re-scope, the
  "N of M" line does not). Could be a future polish item.
- Under host thread pressure, binary launch probes fail → families show
  "Binary present but failed to launch: ... EAGAIN" — honest degradation.
