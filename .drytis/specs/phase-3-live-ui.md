# Phase 3 · Live UI: header display, pending state, formatting polish

## Goal
Polished, stable live token display in the agent header, consistent with the existing dark QASE visual language.

## Current state
- `public/app.js` `renderHeader()` (~424–451) renders `el.usageChip` from `session.tokenUsage`; `formatTokens()` (~416) compacts k/M. `handleEvent()` case `'usage'` (~1937) sets `session.tokenUsage` and re-renders. Sidebar badge `renderRunRow()` (~240–247).

## Changes
1. **Live vs terminal display**: while status is `running`/`awaiting_input`, render counts from the latest `usage` event; when status is terminal (`done`/`error`/`interrupted`/`idle`), render the final persisted value and stop any live behavior (it's event-driven already — just ensure no stale listeners).
2. **Pending/unknown state**: if `tokenUsage` is absent/empty and no usage event has arrived, show a pending state (`-- in · -- out` or "Token usage pending") instead of misleading `0`. Estimated values keep the existing `~` marker.
3. **Stable layout**: fixed-width/tabular numerals (or min-width) on numeric spans so digits changing don't shift layout; verify no overlap with Running badge / Stop control; check smaller viewport widths (responsive) and dark-theme contrast.
4. **Formatting**: consistent thresholds — raw up to 999, `k` below 1M, `M` below 1B, `B` above; at most 1–2 decimals, trailing zeros trimmed (`12.4k`, `2.01M`, `2.15M total`). Total shown as `in + out`. Keep existing format/`ctx %` behavior intact.
5. **Sidebar badges**: refresh the run-row token badge on `usage` events (throttled) instead of only on full `refreshRuns()` refetch.
6. No redesign of the header; only integrate cleanly.

## Files
- `public/app.js` (`renderHeader`, `formatTokens`, `handleEvent`, `renderRunRow`), `public/styles.css` (numeral stability, responsive tweak only).

## Acceptance criteria (running app)
- [ ] Header shows `0 in · 0 out` / pending until first usage, then updates live (e.g. `12.4k in · 3.2k out` → `2.01M in · 6.2k out`) with no layout jumping or overlap.
- [ ] After completion the display shows the exact persisted final value; on failure/stop it shows the last known value.
- [ ] Display is correct and readable at 0, thousands, millions, and very large counts; works on narrow viewports.

## Tests
- Unit (or DOM test): `formatTokens` thresholds and pending state rendering.
- Manual visual pass against screenshot: alignment, typography, overlap, responsive.
- Regression: activity panel, plan panel, findings, report, stop button, streaming all unaffected.
