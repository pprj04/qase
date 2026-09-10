# Phase R2 — Leak elimination (P0/P1)

## G3: awaiting_input never expires (leak/stuck-forever)
Store watchdog skips non-`running` (store.js:354); resource cleanup excludes `awaiting_input` (index.js:214); `BROWSER_IDLE_MS=0` → session + Chromium held indefinitely; mission above eventually failed with wrong attribution (`execution_timeout`).
**Fix**: awaiting-input expiry — new `QASE_AWAITING_INPUT_TIMEOUT_MINUTES` (default 60, clamp 5–1440). Watchdog checks `awaiting_input` sessions past expiry → session `interrupted`, closeBrowser (awaited), clear pendingQuestion, mission finalized honestly (`interrupted` path already legal: running→interrupted).

## G6: pruneOldSessions orphans Chromium
`pruneOldSessions` (store.js:156-188) deletes records without closing the browser or disposing the live record → invisible to all later cleanup.
**Fix**: before `sessions.delete`, close that session's browser via the live map (awaited best-effort with timeout) and dispose the record. Ordering: prune runs in the cleanup timer — acceptable to await.

## G2: .qase/workspaces/<sessionId>/ never deleted (3,429 dirs)
Only creator is agent.js:206-207; nothing deletes. **Fix**: delete workspace dir on session dispose (agent dispose path) and in pruneOldSessions eviction (fs.rm rmSync recursive, best-effort — skip kernel-corrupted dirs silently, they throw EUCLEAN).

## G8: No orphan-Chromium sweep; fire-and-forget closes
No boot sweep of stray chromium; all stop/cleanup paths `void closeBrowser(...)` (documented recommendation never implemented — ~15 zombies/mission, phase-1-closure-audit.md:246-291).
**Fix**: (a) boot sweep before governor start: kill chromium processes whose cmdline contains `ms-playwright`/`.cache/ms-playwright` (at boot no legitimate instance is running; code-server is Node, unaffected); (b) stop paths (v1 :3114, integration :2216, cleanup :1023/:4272) await closeBrowser bounded by the existing 8s bridge timeout.

**Files**: server/store.js, server/index.js, server/agent.js. 
**Acceptance**: expired awaiting_input session → interrupted + browser closed + mission terminal with honest reason; pruning a session closes its browser and removes its workspace dir; workspaces dir count stops growing; boot kills stray playwright chromium; no `void closeBrowser` remains on stop/cleanup paths.
