# Phase 4 · Performance & data management at scale

Goal: keep the picker (and the app) fast with a multi-thousand-environment catalog.

## Changes
- **Card rendering**: render in pages (e.g. 60 cards) with a sentinel-driven "load more" (IntersectionObserver) inside `#dp-cards`; switching category/search resets the window. No full-catalog DOM dump.
- **Client cache**: fetch `/api/environments?limit=20000` once per app session (already the pattern), keep the parsed card index in memory keyed by envId; invalidate on `catalog/refresh` events via existing SSE channel if present, else on picker open.
- **Server list**: default limit stays 500 for non-picker consumers; picker passes explicit `limit` + `offset` only if the one-shot fetch is removed (measure first; keep one-shot if under ~1.5s at final scale).
- **Deduplication & stable IDs**: test asserting unique (device, osVersion, browserCode, browserVersion) tuples and stable envIds across regenerations.
- **Selection preservation**: active selection + add-mode chip list survive category switches and incremental rendering (store-based, already true — add regression test).
- **Search responsiveness**: filtering runs on the in-memory index; debounced input already immediate — assert p95 filter time under 100ms at full scale in a perf smoke test.

## Tests
- Unit: paging math, sentinel reset on filter change, cache invalidation.
- Script: `scripts/perf-catalog.mjs` — loads picker at full catalog size, measures open→interactive and filter timings, asserts budgets; wired as optional npm script (not in CI gate).

## Edge cases
- Empty search results mid-incremental-render; rapid filter toggles (no stale append).
- Very long favorites list interacting with paging.
