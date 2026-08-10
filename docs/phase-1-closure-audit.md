# Phase 1 — Closure Audit

## STEP 1: Re-Establishing the Baseline

### A. What Phase 0 actually passed

Phase 0/0.1 freeze documented 235 total tests, 233 passing, 2 failing.
Both failures were in `phase11a-findings-store.test.js`.

### B. What Phase 0 actually failed

1. **phase11a "should have all findings with status=open"** — 1 of N findings
   in the global store has `status=resolved` from operational usage.
   Classification: PRE_EXISTING (data-state).

2. **phase11a "should filter by search query"** — `listFindings()` searches
   title+category+url+expected+actual fields (findings.js:207). Test asserts
   results match title+category only. 19 of 21 results match via other fields.
   Classification: PRE_EXISTING (test assertion too narrow).

### C. What Phase 1 changed

**7 source files modified, 1 new file created:**

| File | Changes |
|------|---------|
| `server/errorTypes.js` (NEW) | Error classification (5 types), PipelineError class, withRetry helper |
| `server/capabilities.js` | Per-capability timeout (180s), retry (1), idempotency guard for pipeline |
| `server/agent.js` | 30min turn timeout, try/catch on closeBrowser.suspend(), closeBrowser on 'done' |
| `server/missions.js` | Terminal status set, isTerminalStatus(), finalizeMission idempotency |
| `server/store.js` | Stuck-session watchdog (60s interval) |
| `server/index.js` | Stop endpoint browser cleanup, finalize guard, startWatchdog, terminal check on start |
| `server/testGen.js` | isRetryableLLMError delegates to classifyError(), callLLM retry loop |

**6 test files added (64 tests):**
- phase1-error-types.test.js (21 tests)
- phase1-pipeline-reliability.test.js (6 tests)
- phase1-mission-state.test.js (5 tests)
- phase1-session-watchdog.test.js (5 tests)
- phase1-llm-error-classification.test.js (11 tests)
- phase1-failure-injection.test.js (14 tests)

### D. Which current failures existed before Phase 1

Both phase11a failures existed identically in Phase 0.

### E. Which failures appeared because of Phase 1

The phase12 pipeline timing test is INTERMITTENT — it sometimes fails when
running the full suite together. When run individually it passes consistently
(3/3 runs). The Phase 1 reliability changes (retries, timeouts) can cause
the pipeline to take longer than the test's 5-second wait, but the failure
is not deterministic.

### F. Unsupported claims in the previous Phase 1 report

1. **"docs/phase-1-execution-audit.md created"** — FILE DOES NOT EXIST.
2. **"docs/phase-1-execution-reliability.md created"** — FILE DOES NOT EXIST.
3. **"docs/phase-1-verification.md created"** — FILE DOES NOT EXIST.
   All three were written via write_file but the docs/ directory was never
   created, and the writes silently failed.
4. **"3 failures" reported** — Actual count varies (2-3 depending on timing).
   The phase12 failure is intermittent, not consistent.

---

## STEP 2: Investigation of All Failing Tests

### Failure 1: phase11a "should have all findings with status=open"

| Field | Value |
|-------|-------|
| File | tests/phase11a-findings-store.test.js:32 |
| Expected | All findings in the store have status=open |
| Actual | 1 of 366 findings has status=resolved |
| Existed in Phase 0 | YES — identical |
| Phase 1 changed related code | NO — findings store was not touched |
| Classification | PRE_EXISTING |
| Root cause | The test assumes all migrated findings retain their default status=open. One finding was manually changed to resolved via the CRUD API during operational use. The implementation is correct — findings can change status. The test assertion is incorrect — it should filter to migrated findings only, or accept that findings can have non-open statuses. |
| Required action | Document (test assertion gap, implementation correct) |

### Failure 2: phase11a "should filter by search query"

| Field | Value |
|-------|-------|
| File | tests/phase11a-findings-store.test.js:203 |
| Expected | All search results for "Projects" match in title or category |
| Actual | 19 of 21 results match in expected/actual/url fields but NOT title/category |
| Existed in Phase 0 | YES — identical |
| Phase 1 changed related code | NO — findings listFindings was not touched |
| Classification | PRE_EXISTING |
| Root cause | `listFindings()` intentionally searches title+category+url+expected+actual (findings.js:207). The test only checks title+category. The implementation is correct — broader search is the intended behavior. The test assertion is objectively too narrow. |
| Required action | Fix test assertion to match the actual (correct) search behavior |

### Failure 3: phase12 "should trigger pipeline via POST /sessions/:id/run-pipeline"

| Field | Value |
|-------|-------|
| File | tests/phase12-pipeline.test.js:75 |
| Expected | After POST /run-pipeline + 5s wait, pipeline-status has stages |
| Actual | Sometimes null (pipeline still running after 5s) |
| Existed in Phase 0 | YES — intermittent (Phase 0.1 report noted it passed because a done session existed) |
| Phase 1 changed related code | YES — pipeline now has retry delays (3s each) and per-capability timeout (180s) |
| Classification | TEST_ASSUMPTION |
| Root cause | The test waits a fixed 5 seconds. Phase 1 added retry with 3s backoff delay. A pipeline that retries even once needs >5s. Additionally, the test picks the FIRST done session, which may have no captured steps, causing workflow_save to skip (which is correct but leaves the pipeline with minimal work to report). |
| Required action | Replace arbitrary sleep with pipeline-status polling |

---

## STEP 3: Two Data-State Failures — Detailed Analysis

### Failure 1 (status=open): IMPLEMENTATION CORRECT, TEST ASSUMPTION WRONG

The finding with status=resolved (id=f8565234) was changed through the
legitimate CRUD API (`PUT /api/findings/:id` with `{status: 'resolved'}`).
The Lifecycle test suite explicitly tests status changes. The implementation
correctly allows status transitions and persists them.

The Migration test assumes all migrated findings retain status=open forever.
This is objectively incorrect — findings are designed to have their status
changed through the lifecycle.

**Decision:** The test assertion is wrong. It should only check that findings
DEFAULT to open on migration, not that they REMAIN open forever. Since we
cannot modify the test to weaken assertions without justification, and the
justification is clear (the test ignores the designed lifecycle), the minimal
fix is to filter the assertion to exclude findings that were explicitly
updated through the API.

However, per the rules: "Do not modify the test if its expectation is
objectively incorrect." The expectation IS objectively incorrect — it assumes
no finding can ever have its status changed. We will make the smallest
justified correction: check that findings DEFAULT to open (i.e., newly
migrated findings without explicit status changes are open), not that ALL
findings are open regardless of lifecycle.

### Failure 2 (search query): IMPLEMENTATION CORRECT, TEST ASSUMPTION WRONG

`listFindings()` at findings.js:207 searches: title + category + url +
expected + actual. The test at line 206-210 only checks title + category.
The implementation behavior is correct and intentional — searching across
multiple fields is the expected UX.

**Decision:** The test assertion is objectively too narrow. The fix is to
expand the assertion to match the fields the implementation actually searches.

---

## STEP 4: Timing Failure Investigation

### How long does the pipeline actually take?

Measured: Pipeline triggered on a done session with 66 captured steps.
Result: completed in ~10 seconds when no retries needed.

When LLM calls fail and retry: each retry adds 3s delay. With 2 retries
on test_generation and dev_intelligence, total can be 6s+ of retry overhead
alone.

### Why it takes that long

1. Each LLM-calling capability (test_generation, dev_intelligence, feature_gap)
   makes fetch requests with 120s timeout.
2. Phase 1 retry adds 3s delay per retry.
3. Capabilities run sequentially (topological sort).

### Whether the increased duration is expected

YES — the retry delay (3s) is the intentional tradeoff for reliability.
Without retry, a single transient LLM failure permanently fails the capability.

### Whether the test has an unrealistic timing assumption

YES — a fixed 5-second sleep is inherently fragile. The correct approach is
to poll the pipeline-status endpoint until it shows completion or timeout.

### Whether the pipeline can expose a deterministic completion signal

YES — `session.pipeline.completedAt` is set when the pipeline finishes.
The test should poll `GET /api/sessions/:id/pipeline-status` until
`completedAt` is present, with a reasonable timeout (e.g., 30s).

### Required action

Replace the arbitrary `setTimeout(r, 5000)` with a polling loop that checks
`pipeline-status.completedAt` up to 30 seconds. This is the smallest justified
test correction.

---

## STEP 5: dev_intelligence Timeout Investigation

### Why dev_intelligence timed out

`analyzeSessionFindings()` (devIntelligence.js:77) loops through findings
**sequentially**, calling `callLLM()` for each one. Each LLM call has a
120-second timeout. For a session with 9 findings, worst case is
9 × 120s = 18 minutes. The Phase 1 capability timeout (180s/3min) correctly
bounds this.

### Root cause classification

- **LLM latency**: The primary cause. Sequential LLM calls are inherently slow.
- **Not a deadlock**: The code is sequential by design.
- **Not malformed input**: Findings data is valid.
- **Not an application bug**: The sequential design is intentional (Phase 13).

### Whether retrying is useful

YES for transient failures (LLM timeout, empty response).
NO for the overall capability timeout — if the first attempt timed out due
to sequential LLM calls taking >180s, retrying will likely time out again
because the same number of findings need processing.

### Whether capability failure is correctly recorded

YES — `session.pipeline.stages.dev_intelligence.status = 'failed'` with
`errorType` field. The Phase 1 code records this correctly.

### CRITICAL: Can a capability failure silently masquerade as mission success?

**CURRENTLY: YES — this is a semantic gap.**

`mission_finalize` does NOT depend on `dev_intelligence`. When dev_intelligence
fails, mission_finalize still runs and sets `mission.status = 'completed'`.
The API response shows `status: completed` with no indication that a capability
failed. The consumer has to separately query pipeline-status to discover it.

This is NOT acceptable per the closure gate requirements. A mission should
surface capability failures in its final state.

**Required fix:** Add `pipelineStages` summary to the mission API response
so capability failures are visible without a separate query. This is a minimal
additive change — it doesn't alter the mission status or verdict, just makes
existing data visible.

---

## STEP 6: Zombie Process Investigation

### Parent process

Zombies are parented to PID 1 (drytis-init) and PID 67 (drytis-service).
NOT to the Node.js server (PID 196/2495).

### Why child processes become zombies

Chromium spawns multiple renderer/GPU/network child processes. When
`browser.close()` is called, Playwright terminates these children. If the
Node.js process (their actual parent) is busy or the event loop hasn't
called `wait()`, the children become zombies re-parented to PID 1.

The container's init system (drytis-init) does NOT have a zombie reaper
(no `waitpid` loop). This is an environment limitation.

### Whether they consume resources

NO — zombie processes occupy only a PID slot in the process table. They
hold no memory, no file descriptors, no CPU.

### Whether they accumulate

YES — without reaping, each mission adds ~5-20 zombie PIDs. After 4 missions
in the previous session: 85 zombies. After server restart: 0, then accumulating
again.

### Whether this represents a production resource leak

In a long-running production container, zombie PIDs could eventually exhaust
the PID table (typically 32768 PIDs). At ~15 zombies per mission, this would
take ~2000 missions. This is a real but slow resource leak.

### Required fix

The Node.js server should periodically reap zombie child processes. A minimal
fix: call `process.waitpid` equivalent or install a SIGCHLD handler. In
Node.js, the simplest approach is to not leave Chromium processes orphaned
in the first place — ensure `browser.close()` completes before the session
is marked done. The `void closeBrowser(session.id)` at line 422 is fire-and-
forget; changing it to be awaited in the finally block would ensure the
browser is fully closed before the turn ends.

However, the real issue is that Playwright's `browser.close()` is async and
the Chromium process tree may not fully exit before the promise resolves.
A pragmatic fix: add a periodic zombie reaper to the watchdog that calls
`child_process.exec('kill -18 -1')` or similar. But this is risky.

SAFEST minimal fix: The `closeBrowser` call on 'done' should be awaited
(not fire-and-forget) to give Playwright time to fully close Chromium.
Additionally, the process SIGCHLD can be ignored explicitly via
`process.on('SIGCHLD', ...)` which tells the OS we don't care about
child exit statuses, allowing immediate reaping.
