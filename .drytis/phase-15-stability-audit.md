# Phase 15 — Product Stability, Data Consistency & Visible UX
## Step 0: Stability Audit

**Date:** 2026-08-13
**Status:** Audit complete — root cause identified, fix plan defined

---

## Executive Summary

QASE's frontend is a vanilla-JS SPA with hash routing, a shared global state object, SSE for live updates, and sequential API calls for hydration. The backend APIs are fast (all under 150ms). The reload problem is **entirely in the frontend boot/hydration sequence**, not the backend or persistence layer.

---

## 1. RELOAD PROBLEM ROOT CAUSE

### The Problem
After refresh: empty state → data appears gradually → sometimes needs second refresh.

### Root Cause: Sequential Hydration Chain
`selectSession()` (app.js:71-124) performs **6 sequential `await` calls** after the initial renders:

```
selectSession(id)
  → await api('/sessions/:id')              // 1st round-trip
  → [lazy load: messages, steps, findings]   // parallel if heavy (good)
  → renderHeader, renderTranscript, etc.     // synchronous renders
  → await loadWorkflows()                    // 2nd round-trip (SEQUENTIAL)
  → await loadTestCases()                    // 3rd round-trip (SEQUENTIAL)
  → await loadRegression()                   // 4th round-trip (SEQUENTIAL)
  → await loadMetrics()                      // 5th round-trip (SEQUENTIAL)
  → await loadPipelineFromSession(id)        // 6th round-trip (SEQUENTIAL)
  → await loadDevIntelFromSession(id)        // 7th round-trip (SEQUENTIAL)
  → connect(id)                              // SSE opened
  → await refreshRuns()                      // 8th round-trip
```

Each `await` blocks the next. With 6 sequential round-trips at ~50ms each (plus render time), hydration takes 300-500ms minimum. During this time, the UI shows partial state — some panels are still empty while others are rendered.

### Contributing Factors

1. **No loading indicators during hydration** — between the initial renderHeader() and the final loadDevIntelFromSession(), panels show their empty states ("Nothing yet", "No findings filed yet") instead of loading indicators.

2. **Error swallowing creates false empty states** — `.catch(() => [])` turns API failures into empty arrays. The user can't distinguish "genuinely empty" from "backend error". This is the cause of "data appears after several minutes" — a failed request returns [], then SSE events or a later navigation triggers a successful reload.

3. **Pipeline data not persisted on all sessions** — only 386/617 sessions have `pipeline` data. The frontend's `loadPipelineFromSession()` makes another API call but if pipeline data is missing, the quality/decision/understanding panels show nothing.

4. **`toast(fail(error), 'bad')` double-toast bug** — `fail()` already calls `toast()`, so `toast(fail(error), 'bad')` calls toast twice (once with the real error, once with undefined). This creates blank error toasts.

5. **Boot fail-soft** — config/session/project failures all swallow into empty arrays. If the backend is down, boot silently calls `startRun()` (POST /sessions) with no error handler.

---

## 2. FRONTEND ARCHITECTURE

### Routing
- Hash-based (`#/runs`, `#/tests`, `#/workflows`, `#/schedules`, `#/bugs`)
- No deep linking (router.js:57 discards path segments after first `/`)
- Page switching is DOM-toggling (all page containers exist simultaneously)

### State Management
- Single mutable global `state` object (shared.js:126-151)
- No reactivity — direct imperative mutation + explicit re-render calls
- Cross-page data sharing through this shared global
- localStorage persistence for: session ID, project ID, theme

### API Client
- Central `api(path, options)` wrapper (shared.js:155-165)
- Prepends `/api`, handles JSON, throws on non-ok
- **30+ instances of `.catch(() => [])` or empty `catch {}` across all modules**

### SSE
- Single `EventSource('/api/sessions/:id/events')` per session
- Auto-reconnect (browser-managed) but **no state reconciliation on reconnect**
- Session ID guard prevents stale events (`data.sessionId === state.sessionId`)

---

## 3. ERROR HANDLING ISSUES

| Pattern | Count | Impact |
|---------|-------|--------|
| `.catch(() => [])` | ~15 | API failure shows as empty state |
| `.catch(() => undefined)` | ~3 | Config failure silently skipped |
| `.catch(() => null)` | ~2 | Evidence failure hidden |
| Empty `catch {}` | ~24+ | Failures completely hidden |
| `toast(fail(error), 'bad')` | ~7 | Double/blank toast bug |
| Raw `fetch` without `.catch` | ~2 | Unhandled rejections |

---

## 4. SETTINGS AUDIT

All settings are functional — every field is read by `readSettings()` and PUT to `/config`. No decorative-only settings found.

| Category | Status |
|----------|--------|
| AI/Model (provider, key, base URL, model, reasoning) | ✅ Working |
| Execution (max turns, headless, concurrency, retries) | ✅ Working |
| Auto features (workflow, tests, smoke, schedule, dev report) | ✅ Working |
| Viewports | ✅ Working |
| Self-heal | ✅ Working |
| API token (Bearer auth) | ✅ Working |
| BrowserStack | ✅ Config fields work, but need verification of actual connectivity |
| Test connection button | ✅ Working (POST /config/test) |

---

## 5. FIX PLAN

### Fix 1: Parallelize selectSession hydration (ROOT CAUSE FIX)
Change the 6 sequential awaits to `Promise.all` — load workflows, test cases, regression, metrics, pipeline, and dev-intel in parallel.

### Fix 2: Add loading states to panels
Before each API call, show "Loading..." in the target panel. After data arrives, render normally.

### Fix 3: Replace `.catch(() => [])` with error-aware fallbacks
Each catch should store an error state, not silently produce empty data.

### Fix 4: Fix `toast(fail(error), 'bad')` → `fail(error)`
Remove the redundant `toast()` wrapper.

### Fix 5: Add error state rendering to key panels
Panels should show "Unable to load. Retry." when their API call fails.

### Fix 6: Boot error handling
If config/session/project fetch fails, show a clear error instead of silently continuing.
