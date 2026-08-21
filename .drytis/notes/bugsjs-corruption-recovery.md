# public/bugs.js corruption + recovery (Aug 21, 2026, Build 4)

## What happened
- Disk copy of /workspace/public/bugs.js was corrupted at 12:55 UTC (before
  Build 4 session start) — binary garbage, 55735 bytes, ext4 corruption from
  container pause mid-IO (same class as phase16/phase18 incidents).
- The OLD qase-server process (pre-13:34) had the valid file open/cached and
  served 46811 valid bytes over HTTP — confirmed at 13:31 via curl.
- Server restarted 13:34 → began serving the garbage from disk.

## Recovery
- Chrome HTTP disk cache (Playwright MCP browser profile) held TODAY's valid
  copy, fetched 13:33: `61b1e87f2418ac29_0` in
  ~/.cache/ms-playwright-mcp/mcp-chrome-c52ddf6/Default/Cache/Cache_Data.
- Extracted body between the `import { el, state...` marker and the final
  `export { loadBugs, openBugDetail, initBugsWiring };` statement → 46726
  bytes. `node --check` passes. Contains full Phase 18 fix-validation UI
  (FIX_STATUS_LABELS, renderFixValidationSection, fx* helpers, history modal),
  Build 1 silent-catch fix (showPageLoading/showPageError imports).
- Installed to public/bugs.js (git diff now shows +443/-38 vs HEAD — sensible
  Build 1-3 delta, NOT binary).

## Lesson
Chrome's disk cache entries `_0` files embed the full response body after a
plaintext header (key URL + headers). `grep -rl "<unique string>" Cache_Data`
then extract marker→end-marker is a viable recovery path for corrupted static
assets. git index/HEAD had only the older pre-Build-2 version — uncommitted
work would otherwise be lost.
