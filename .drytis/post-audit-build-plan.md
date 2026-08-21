# QASE — Post-Audit Verification & Final Build Plan

**Date:** 2026-08-13  
**Method:** Code inspection + runtime verification (3 real missions, concurrency tests, persistence tests, log analysis)  
**Baseline audit:** `.drytis/full-system-audit.md` (2026-08-12)

---

## A. VERIFIED CURRENT STATE

### A1. The Autonomous Pipeline — REAL AND WORKING

**Verified by:** Real mission `2fab6a83` against ContactVault (port 9906), completed autonomously in 207s with no human intervention.

| Stage | Status | Evidence |
|---|---|---|
| Mission creation | ✅ REAL | POST /api/v1/missions → 202 with missionId, sessionId, correlationId |
| Worker startup | ✅ REAL | Fire-and-forget runAgent(), autoStart=true |
| Agent execution | ✅ REAL | 30 turns, 27 captured steps, 16 messages |
| Browser automation | ✅ REAL | Navigate, snapshot, click, fill, screenshot |
| Exploration | ✅ REAL | Agent explored add/delete contacts, form validation, email entry |
| Evidence | ✅ REAL | 41 evidence items + 12 workflow step evidence items collected |
| Findings | ✅ REAL | 3 findings (1 workflow-generated, 2 agent-filed) |
| Assessment | ✅ REAL | Quality score=15, verdict=fail, releaseReady=false |
| Decision | ✅ REAL | makeDecisionSafe → STOP_PASS (overridden by quality verdict) |
| Revalidation | ✅ REAL | Self-HTTP call succeeded, iteration 2 started and completed |
| Final report | ✅ REAL | Mission finalized with all fields populated |
| Persistence | ✅ REAL | missions.json, sessions.json, evidence-graph.json, findings.json all written |

**CAN QASE COMPLETE THIS WITHOUT HUMAN INTERVENTION? → YES.**

Two additional concurrent missions also completed autonomously:
- Mission `730dc385` (TaskFlow): 226s, 0 findings, verdict=pass
- Mission `93d24a25` (ContactVault): 226s, 2 findings, verdict=fail

### A2. Application Understanding — REAL BUT HEURISTIC-ONLY

**Critical finding:** The autonomous path uses ONLY heuristic analysis. The LLM-enhanced understanding (`buildAppUnderstanding` with `derivePurposeWithLLM`) exists in `capabilities.js` but is **only triggered manually** via `POST /api/sessions/:id/run-pipeline`. The autonomous finalization (`finalizeMissionFromSession` in `index.js`) does NOT call it.

| Understanding Source | Used in Autonomous Path | Used in Manual Pipeline |
|---|---|---|
| Heuristic purpose inference (`inferAppPurpose`) | ✅ YES | ✅ YES |
| Mission context keywords (`deriveContextFeatures`) | ✅ YES | ✅ YES |
| Domain classification (`classifyDomain`) | ✅ YES | ✅ YES |
| Feature template matching (`generateExpectedFeatures`) | ✅ YES | ✅ YES |
| Observed feature extraction (`buildObservedFeatures`) | ✅ YES | ✅ YES |
| Expected vs observed comparison | ✅ YES | ✅ YES |
| **LLM purpose derivation** (`derivePurposeWithLLM`) | ❌ **NO** | ✅ YES |
| **LLM gap enhancement** (`enhanceGapsWithLLM`) | ❌ **NO** | ✅ YES |
| **Knowledge learning** (`writeKnowledge`) | ❌ **NO** | ✅ YES |

**Confidence levels observed:** CRM=0.46, SaaS Admin=0.72, Marketing=0.76, Project Management=0.80. These are acceptable for known domains but would be low for novel applications.

**Is application understanding a blocker?** → **NO, for supported domains.** The heuristic pipeline correctly classifies 11 domain types and generates relevant expected features. It would be a blocker for novel/unfamiliar applications where keyword matching fails.

### A3. Concurrency — AUDIT WAS WRONG

**The audit's P0-1 finding ("concurrentRuns=20 with 1 browser instance") is INCORRECT.**

**Evidence:** Each `ensureRuntime()` call in `agent.js` creates a separate `CleanSlateNodeAgentRuntime` which manages its own Chrome instance. Two simultaneous missions were observed running with:
- 3 separate Chrome processes (PIDs 897, 1028, 1103), each with distinct `--user-data-dir`
- Both missions progressed independently in the logs (interleaved turn counts)
- Both completed successfully with correct verdicts
- `closeOtherBrowsers()` only closes sessions where `!running`, so concurrent missions are never killed

**The real concurrency concern is MEMORY:** Each Chrome instance uses ~400-500MB. With 6GB container RAM:
- concurrentRuns=20 → potentially 20 × 500MB = 10GB → **OOM crash**
- Safe concurrency = **3-4** (3 × 500MB = 1.5GB + 400MB Node + overhead)

**Recommended concurrentRuns:** Set to **3** (safe for 6GB containers).

### A4. JavaScript Dialog Handling — CONFIRMED P0 BUG (DIFFERENT ROOT CAUSE)

The audit said "no dialog handler exists." The actual root cause is different and more specific:

**Root cause:** The SDK already has dialog handling — `page.on('dialog')` captures dialogs and the `browser_dialog` tool can accept/dismiss them. BUT:

1. **`prompt.js` line 40** tells the agent: `"browser_tabs, browser_new_tab, browser_select_tab, browser_close_tab, browser_dialog"` are available
2. **`agent.js` ALLOWED_TOOLS** does NOT include `browser_dialog` (or `browser_new_tab`, `browser_select_tab`, `browser_close_tab`)
3. When the agent encounters a dialog, it believes it can use `browser_dialog`, tries to, and gets **blocked** by `approveTool`
4. Playwright's `page.on('dialog')` handler stores the dialog but doesn't auto-dismiss, so the dialog **blocks all subsequent page interactions**

**This is a prompt/tool-list inconsistency, not a missing feature.**

### A5. Revalidation — WORKS BUT FRAGILE

The self-HTTP-call pattern (`fetch('http://localhost:5173/api/v1/missions/:id/revalidate')`) works in practice — verified by triggering revalidation that successfully created iteration 2.

**Risk assessment (REVISED DOWNWARD):**
- `setImmediate()` defers the call after the current event loop tick, so the server IS available
- The main risk is server restart during finalization, which is an edge case
- NOT a P0 or P1. Downgrade to **P2** (nice-to-have improvement)

### A6. Data Persistence — WORKING WITH GAPS

| Store | Persists to Disk | Survives Restart | Issue |
|---|---|---|---|
| missions.json | ✅ Yes | ✅ Yes | Uses raw `writeFileSync` (not atomic) — corruption risk on crash |
| sessions.json | ✅ Yes | ✅ Yes | Last 50 only (pruned aggressively) |
| evidence-graph.json | ✅ Yes | ✅ Yes | Unbounded growth (no pruning) |
| findings.json | ✅ Yes | ✅ Yes | ✅ None |
| knowledge.json | ✅ Yes | ✅ Yes | ✅ None |
| **Webhooks** | ❌ **In-memory only** | ❌ **LOST on restart** | Registration lost, delivery log lost |

**`findingsCount` field bug:** missions.json stores `findingsCount=undefined` because `finalizeMission()` doesn't set it. The API computes it correctly from session data at query time, so the user always sees the correct count. The stored value is stale/wrong but doesn't affect user-facing behavior.

### A7. Frontend Data Staleness — ROOT CAUSE CONFIRMED

**Root cause (two compounding issues):**

1. `/api/sessions` returns **summary objects** only (`id, status, findingCount, messageCount`) — no messages, no activities. This is BY DESIGN for performance.

2. `selectSession(id)` in `app.js` fetches `/api/sessions/:id` then lazy-loads details via `/api/sessions/:id/detail?field=messages`. If the detail fetch fails, the `.catch(() => [])` **silently returns an empty array**, making the session appear to have no messages.

The "old data after reload" symptom is caused by issue #2 — failed detail fetches show empty content instead of error states. NOT by the session list.

### A8. API Security — CONFIRMED

- **Integration API** (`/api/v1/*`, 29 routes): ✅ All authenticated via `requireIntegrationAuth`
- **Internal API** (`/api/*`): ~20 GET routes expose data without auth, 1 PATCH route (`/api/findings/:id/status`) allows mutations without auth
- **Webhook SSRF**: ✅ Protected (blocks internal IPs)
- **Webhook HMAC**: ✅ SHA256 signature
- **JWT auth**: ✅ HS256 via jose

---

## B. VERIFIED BLOCKERS

### B1. P0 — Prevents Reliable Autonomous Testing

| # | Blocker | Evidence | Root Cause |
|---|---|---|---|
| **P0-1** | `browser_dialog` not in ALLOWED_TOOLS | `agent.js` line ~135; `prompt.js` line 40 | Prompt lists the tool but ALLOWED_TOOLS excludes it. Agent can't dismiss alert/confirm/prompt dialogs. |
| **P0-2** | `writeKnowledge` not in autonomous path | `capabilities.js` line 617 vs `index.js` finalizeMissionFromSession | Knowledge learning only runs in manual pipeline. Autonomous missions never learn from findings. |

**NOTE:** The original audit's P0-1 (concurrentRuns=20 with 1 browser) is **WRONG** — verified that concurrent missions get separate browsers. Reclassified to P1 (memory limit concern).

### B2. P1 — Causes Unreliable Autonomous Testing

| # | Issue | Evidence | Impact |
|---|---|---|---|
| **P1-1** | concurrentRuns=20 risks OOM | 3 Chrome instances = 1260MB; 20 would = 8-10GB | Container crash when many missions run simultaneously |
| **P1-2** | missions.js uses raw writeFileSync | `missions.js` line 76 | Data corruption if write interrupted by crash |
| **P1-3** | Webhooks in-memory only | No webhooks.json on disk | Webhook registrations lost on server restart |
| **P1-4** | Frontend `.catch(() => [])` on detail fetches | `app.js` lines 82-84 | Failed fetches show empty data instead of error |
| **P1-5** | Tab tools blocked | ALLOWED_TOOLS missing browser_new_tab/select_tab/close_tab | Agent can't manage tabs when popups open |

### B3. P2 — Product Quality

| # | Issue |
|---|---|
| P2-1 | No global error handler in Express (unhandled errors crash process) |
| P2-2 | Internal API GET routes expose data without auth (~20 routes) |
| P2-3 | PATCH /api/findings/:id/status missing auth |
| P2-4 | Session pruning deletes permanently (no archive) |
| P2-5 | Evidence graph unbounded growth (9.8MB, 14K items) |
| P2-6 | LLM-enhanced understanding not in autonomous path |
| P2-7 | Self-HTTP-call for revalidation (fragile, should be direct function call) |
| P2-8 | 1358 stale "created" missions in data (never started) |

### B4. P3 — Cleanup/Polish

| # | Issue |
|---|---|
| P3-1 | Empty directories: `validationLoop_corrupt.js/`, `validationLoop_recovered.js/` |
| P3-2 | 49 PNG screenshots in root |
| P3-3 | qase-project.zip / .tar.gz archives |
| P3-4 | Duplicate documentation locations (docs/, .drytis/, userDocs/) |
| P3-5 | `tests_old/` superseded files |

---

## C. FALSE / OUTDATED FINDINGS FROM ORIGINAL AUDIT

| Audit Finding | Verdict | Evidence |
|---|---|---|
| "concurrentRuns=20 with 1 browser instance causes contention" | **FALSE** | Each session creates its own Chrome instance. Verified with 3 concurrent processes. |
| "No `alert()`/`confirm()` dialog handler" | **PARTIALLY FALSE** | The SDK HAS dialog handling (`page.on('dialog')` + `browser_dialog` tool). The bug is that ALLOWED_TOOLS excludes it, not that it doesn't exist. |
| "Self-HTTP-call for revalidation is fragile" | **OVERSTATED** | Works in practice with setImmediate defer. Downgrade to P2. |
| "Agent has 30 turns which is insufficient" | **CONTEXTUAL** | 30 turns is adequate for simple-medium apps. Complex apps need more, but maxTurns is configurable. |
| "The biggest limitation is keyword/regex matching" | **PARTIALLY TRUE** | LLM-enhanced understanding exists but isn't wired to the autonomous path. The heuristic pipeline works for 11 known domains. |

---

## D. CORE AUTONOMOUS PIPELINE STATUS

### The Autonomous Loop

| Stage | Status | Mechanism | Notes |
|---|---|---|---|
| **DISCOVER** | ✅ REAL | POST /api/v1/missions with targetUrl | External trigger or scheduled |
| **UNDERSTAND** | ⚠️ PARTIAL | Heuristic domain/intent classification | LLM enhancement exists but NOT in autonomous path |
| **PLAN** | ⚠️ PARTIAL | Agent creates test plan via update_todo tool | LLM-driven, not systematic |
| **EXECUTE** | ✅ REAL | Agent performs browser actions via SDK | 30 turns max, 20 tools |
| **OBSERVE** | ✅ REAL | Snapshots, diagnostics, screenshots | Full DOM + console + network |
| **DETECT** | ⚠️ PARTIAL | Agent reports findings + workflow engine validates | Agent misses subtle bugs; workflow engine catches structural gaps |
| **EVIDENCE** | ✅ REAL | 12 evidence types, 14 edge types | Comprehensive |
| **ASSESS** | ✅ REAL | Quality scoring (logarithmic model) + decision engine | Deterministic |
| **DECIDE** | ✅ REAL | 7 decision types, safety overrides | STOP_PASS overridden by quality=fail is correct |
| **REVALIDATE** | ✅ REAL | Self-HTTP call, up to 10 iterations | Works but uses HTTP-to-self pattern |
| **LEARN** | ❌ **MISSING** | writeKnowledge NOT called in autonomous path | Only runs in manual pipeline |
| **PLAN NEXT ACTION** | ❌ **MISSING** | No learning → no improvement across runs | Each mission starts from scratch |

### Key Gap: LEARN → PLAN NEXT ACTION

The "LEARN" stage is the most critical structural gap. Without `writeKnowledge` in the autonomous finalization path:

1. Every mission starts with the same heuristic baseline — no accumulated knowledge
2. Findings from previous runs of the same app are not learned
3. The system cannot improve its test coverage over successive runs
4. The "autonomous loop" is open — it never closes the learning cycle

**However, this does NOT prevent a single autonomous mission from completing successfully.** It prevents the system from getting better over time.

---

## E. MINIMUM FIXES REQUIRED

### P0 Fixes (MUST DO for reliable autonomous testing)

#### P0-1: Add missing browser tools to ALLOWED_TOOLS
- **Problem:** Agent can't dismiss JS dialogs, can't manage tabs
- **Evidence:** `prompt.js` lists `browser_dialog` etc. but `agent.js` ALLOWED_TOOLS excludes them
- **Root cause:** Prompt was updated but ALLOWED_TOOLS wasn't
- **Fix:** Add `browser_dialog`, `browser_new_tab`, `browser_select_tab`, `browser_close_tab` to ALLOWED_TOOLS
- **Files:** `server/agent.js` (1 line change — add to Set)
- **Dependencies:** None
- **Risk:** None — these are standard Playwright operations the SDK already supports
- **Effort:** Trivial

#### P0-2: Add writeKnowledge to autonomous finalization
- **Problem:** Autonomous missions never learn from findings
- **Evidence:** `writeKnowledge` only called in `capabilities.js:617`, not in `finalizeMissionFromSession`
- **Root cause:** Capabilities pipeline (manual) and finalization pipeline (autonomous) diverged
- **Fix:** Call `writeKnowledge(findings, session, mission.id)` in `finalizeMissionFromSession` after evidence collection
- **Files:** `server/index.js` (3 lines added to finalizeMissionFromSession)
- **Dependencies:** Import writeKnowledge from knowledge.js
- **Risk:** Low — writeKnowledge is idempotent (checks for existing patterns)
- **Effort:** Small

### P1 Fixes (SHOULD DO for production reliability)

#### P1-1: Set concurrentRuns to 3
- **Fix:** Change config.json `concurrentRuns` from 20 to 3
- **Files:** `.qase/config.json`
- **Risk:** None — prevents OOM
- **Effort:** Trivial

#### P1-2: Use atomicWrite in missions.js
- **Fix:** Replace `writeFileSync` with `atomicWrite` at line 76
- **Files:** `server/missions.js`
- **Dependencies:** Import atomicWrite
- **Risk:** None
- **Effort:** Trivial

#### P1-3: Persist webhooks to disk
- **Fix:** Write webhook registrations to `.qase/webhooks.json`
- **Files:** `server/webhooks.js` (or inline in index.js)
- **Risk:** None
- **Effort:** Small

#### P1-4: Show error states in frontend instead of empty catch
- **Fix:** Replace `.catch(() => [])` with error display in `selectSession()`
- **Files:** `public/app.js` lines 82-84
- **Risk:** Low
- **Effort:** Small

---

## F. OPTIONAL FIXES (P2)

| # | Fix | Effort |
|---|---|---|
| P2-1 | Add global Express error handler | Small |
| P2-2 | Add auth to internal GET routes | Medium |
| P2-3 | Add auth to PATCH /api/findings/:id/status | Trivial |
| P2-4 | Archive sessions instead of deleting | Small |
| P2-5 | Prune evidence graph by age | Medium |
| P2-6 | Wire LLM-enhanced understanding into autonomous path | Medium |
| P2-7 | Replace self-HTTP revalidation with direct function call | Small |
| P2-8 | Cleanup stale "created" missions | Small |

---

## G. DEAD CODE CLEANUP — LATER

| Item | Classification | Reason |
|---|---|---|
| `validationLoop_corrupt.js/` (empty dir) | REMOVE LATER | Leftover from ext4 corruption |
| `validationLoop_recovered.js/` (empty dir) | REMOVE LATER | Same |
| `pipeline.js` (17-line re-export shim) | KEEP | Used by capabilities.js import path |
| `bugExporters.js` | KEEP | Imported by index.js for export routes |
| `tests_old/` | REMOVE LATER | Superseded |
| `selfHeal.js` | KEEP | Wired to selector healing in browserBridge |
| `baselines.js`, `regressionStore.js`, `replayStore.js` | KEEP | Used by test case replay |
| `demoSite.js` | KEEP | Provides built-in practice target |
| 49 PNG files in root | REMOVE LATER | Unrelated artifacts |
| `qase-project.zip/.tar.gz` | REMOVE LATER | Redundant archives |
| `chrometrace.log` | REMOVE LATER | Debug artifact |

**No duplicate execution engines, duplicate agent implementations, or dormant core/v2 directories exist.**

---

## H. UI/UX WORK — LATER

| Issue | Priority |
|---|---|
| No loading skeletons | P3 |
| No frontend build/minification | P3 |
| No pagination on sessions API | P2 |
| No 404 catch-all route | P3 |

---

## I. SECURITY WORK

| Issue | Priority | Effort |
|---|---|---|
| PATCH /api/findings/:id/status missing auth | P2 | Trivial (add requireApiToken) |
| ~20 GET routes lack auth | P2 | Medium (add requireApiToken to sensitive GETs) |
| No rate limiting | P3 (FUTURE) | Small (express-rate-limit) |
| No global error handler | P2 | Small |

**Context:** The internal API is designed for single-user local usage behind the dashboard. The integration API (`/api/v1/*`) is properly secured. Adding auth to internal routes is defense-in-depth, not a critical fix for autonomous operation.

---

## J. PERFORMANCE WORK

| Issue | Priority | Effort |
|---|---|---|
| Session pruning (last 50 only) | P2 | Small (increase limit or add archive) |
| Evidence graph unbounded growth | P2 | Medium (add age-based pruning) |
| 1358 stale "created" missions | P2 | Small (add TTL cleanup) |
| No pagination on /api/sessions | P2 | Medium |

---

## K. AUTONOMOUS LOOP WORK

| Missing Stage | Fix Required | Priority |
|---|---|---|
| LEARN | Add `writeKnowledge` to finalizeMissionFromSession | **P0** |
| PLAN NEXT ACTION | Emerges automatically once LEARN is wired (queryKnowledge reads accumulated patterns at mission start) | **P0** (same fix) |
| UNDERSTAND (LLM-enhanced) | Wire buildAppUnderstanding into autonomous path | P2 (optional improvement) |

---

## L. TEST PLAN

### Unit Tests
- Test ALLOWED_TOOLS includes browser_dialog after fix
- Test writeKnowledge is called in finalizeMissionFromSession
- Test missions.js uses atomicWrite
- Test webhook persistence to disk

### Integration Tests
- Create mission with JS dialog app → verify agent dismisses dialog
- Create mission against known app → verify knowledge.json grows
- Run 3 concurrent missions → verify no OOM
- Restart server → verify webhooks survive

### E2E Test
- POST /api/v1/missions against dialog-heavy app → verify completed with findings
- POST /api/v1/missions twice against same app → verify second run has knowledge patterns

---

## M. FINAL ACCEPTANCE CRITERIA

### Minimum Autonomous Product (MAP)

The smallest product that can honestly be called "Autonomous QA":

1. ✅ Receive an application (POST /api/v1/missions with targetUrl) — **WORKS**
2. ⚠️ Understand it (heuristic domain/intent classification) — **WORKS for known domains**
3. ✅ Decide what to test (agent creates plan via update_todo) — **WORKS**
4. ✅ Explore it (30-turn browser exploration) — **WORKS**
5. ✅ Execute tests autonomously (browser actions) — **WORKS**
6. ✅ Detect bugs (agent-filed + workflow-generated findings) — **WORKS**
7. ✅ Capture evidence (41 evidence items per mission) — **WORKS**
8. ✅ Deduplicate findings (threshold=0.38) — **WORKS**
9. ✅ Assess quality (logarithmic scoring + decision engine) — **WORKS**
10. ⚠️ Revalidate findings (self-HTTP call, up to 10 iterations) — **WORKS but fragile**
11. ✅ Produce a report (GET /api/v1/missions/:id/report) — **WORKS**
12. ❌ Run again without manual test authoring — **BROKEN** (no learning accumulation)

**Items 1-11 are CORE (working or fixable with P0/P1).**
**Item 12 requires P0-2 (writeKnowledge in autonomous path).**

### Feature Classification

| Feature | Classification |
|---|---|
| API mission creation + async execution | **CORE** — Working |
| Heuristic app understanding | **CORE** — Working |
| LLM-enhanced app understanding | **NEXT** — Exists but not in autonomous path |
| Agent exploration (30 turns) | **CORE** — Working |
| Browser automation (Playwright) | **CORE** — Working |
| JS dialog handling | **CORE** — Blocked by P0-1 (one-line fix) |
| Evidence system | **CORE** — Working |
| Findings + dedup | **CORE** — Working |
| Quality assessment | **CORE** — Working |
| Decision engine | **CORE** — Working |
| Revalidation loop | **CORE** — Working |
| Knowledge learning | **CORE** — Blocked by P0-2 (3-line fix) |
| Webhook delivery | **CORE** — Working (in-memory persistence is P1) |
| Report generation | **CORE** — Working |
| BrowserStack integration | **FUTURE** — Not wired to agent |
| Semantic/embedding-based detection | **FUTURE** — Not implemented |
| Frontend dashboard | **NEXT** — Working but has UX issues |
| Visual regression testing | **FUTURE** — Exists in replay.js |
| Test case generation | **NEXT** — Exists in testGen.js |

---

## N. PRIORITIZED IMPLEMENTATION ORDER

### Phase 1: P0 Fixes (MUST — enables reliable autonomous testing)

| Order | Fix | File(s) | Effort |
|---|---|---|---|
| 1 | Add browser_dialog + tab tools to ALLOWED_TOOLS | `server/agent.js` | Trivial |
| 2 | Add writeKnowledge to finalizeMissionFromSession | `server/index.js` | Small |
| 3 | Set concurrentRuns=3 | `.qase/config.json` | Trivial |
| 4 | Replace writeFileSync with atomicWrite in missions.js | `server/missions.js` | Trivial |

### Phase 2: P1 Fixes (SHOULD — production reliability)

| Order | Fix | File(s) | Effort |
|---|---|---|---|
| 5 | Persist webhooks to disk | `server/webhooks.js` or `index.js` | Small |
| 6 | Fix frontend .catch(() => []) error swallowing | `public/app.js` | Small |
| 7 | Add global Express error handler | `server/index.js` | Small |

### Phase 3: P2 Fixes (NICE — product quality)

| Order | Fix | File(s) | Effort |
|---|---|---|---|
| 8 | Add auth to PATCH /api/findings/:id/status | `server/index.js` | Trivial |
| 9 | Replace self-HTTP revalidation with direct call | `server/index.js` | Small |
| 10 | Wire LLM-enhanced understanding into autonomous path | `server/index.js` | Medium |
| 11 | Cleanup stale "created" missions | `server/index.js` | Small |
| 12 | Add pagination to sessions API | `server/index.js` | Medium |

---

## O. FINAL GO/NO-GO

### Can we now proceed directly to implementation?

**→ YES.**

All blockers have been verified through code inspection and runtime testing. The fixes are well-scoped, localized, and low-risk.

### Exact Implementation Order

1. **`server/agent.js`** — Add `browser_dialog`, `browser_new_tab`, `browser_select_tab`, `browser_close_tab` to ALLOWED_TOOLS (1 line)
2. **`server/index.js`** — Add `writeKnowledge` import + call in `finalizeMissionFromSession` after evidence collection (3 lines)
3. **`.qase/config.json`** — Change `concurrentRuns` from 20 to 3 (1 value)
4. **`server/missions.js`** — Replace `writeFileSync` with `atomicWrite` (2 lines: import + call)
5. **Run regression suite** — Verify 0 failures
6. **Run E2E test** — Mission against dialog-heavy app + verify knowledge accumulation

### Risk Assessment

| Change | Risk | Mitigation |
|---|---|---|
| ALLOWED_TOOLS expansion | None — SDK already supports these tools | Test against dialog app |
| writeKnowledge in finalization | Low — function is idempotent | Verify no duplicate patterns |
| concurrentRuns=3 | None — prevents OOM | Verify concurrent missions work |
| atomicWrite in missions.js | None — same file format | Verify missions.json loads after write |

---

## P. ANSWER TO THE FINAL QUESTION

**"What is the shortest technically safe path from the current QASE codebase to a genuinely autonomous QA system that can repeatedly test a real application without human-authored test cases?"**

**Answer: 4 changes, all trivial-to-small effort, no architecture changes:**

1. **Unblock the dialog tool** — Add `browser_dialog` to ALLOWED_TOOLS in `agent.js` (1 line). Without this, any app using `alert()`/`confirm()` derails the agent.

2. **Close the learning loop** — Call `writeKnowledge` in `finalizeMissionFromSession` in `index.js` (3 lines). Without this, QASE never learns from completed missions and can't improve over successive runs.

3. **Prevent OOM** — Set `concurrentRuns` to 3 in config.json (1 value). Without this, 20 simultaneous Chrome instances crash the container.

4. **Prevent data corruption** — Switch `missions.js` to `atomicWrite` (2 lines). Without this, a crash during write corrupts the mission store.

**Total: ~7 lines of code across 4 files. Zero new modules, zero architecture changes, zero dependencies.**

The core engine — agent runtime, browser automation, evidence system, findings pipeline, quality scoring, decision engine, revalidation loop — is already production-ready. These 4 fixes address the gaps between what the system CAN do and what it RELIABLY does autonomously.
