# Phase 1 — Execution Audit

## Current Execution Flow

### Mission Lifecycle

1. `POST /api/v1/missions` → creates mission (status=created or running if autoStart)
2. `POST /api/v1/missions/:id/start` → creates session, starts agent turn
3. Agent runs: `startTurn()` → `runTurn()` → streams SDK events → browser tools → findings
4. Agent calls `finish_qa_report` → sets session.report → `runAutonomyPipeline()` (fire-and-forget)
5. `runTurn` completes → `setStatus('done')` → `closeBrowser()` + `record.dispose()`
6. Pipeline runs capabilities in topological order (workflow_save → test_generation → ... → knowledge_write)
7. `GET /api/v1/missions/:id` poll detects session done → `finalizeMissionFromSession()` → mission=completed

### Failure Paths

| Failure | Handling (pre-Phase 1) | Phase 1 Fix |
|---------|----------------------|-------------|
| LLM timeout | Model-specific regex retry (2 attempts) | Centralized classifyError + withRetry |
| LLM empty response | No retry in callLLM | Retry via isRetryableLLMError |
| LLM 429/5xx | No retry | Retry as transient/infrastructure |
| Capability hangs | No timeout — indefinite | 180s per-capability timeout |
| Session stuck running | loadSessions marks interrupted on restart | Watchdog (60s interval) |
| Browser not cleaned up on done | Never disposed | closeBrowser on 'done' + record.dispose |
| Double finalization | No guard | isTerminalStatus check in 3 places |
| Pipeline runs twice | No guard | session._pipelineRunning flag |
| Mission stop doesn't close browser | Only aborts controller | Also calls closeBrowser |
| closeBrowser fails on suspend | Uncaught error | try/catch wrapper |

### Timeout Behavior

| Operation | Timeout | Mechanism |
|-----------|---------|-----------|
| Agent turn | 30 min | SESSION_TURN_TIMEOUT_MS timer |
| LLM call (testGen) | 120s | AbortSignal.timeout |
| Capability execution | 180s | CAPABILITY_TIMEOUT_MS via withRetry |
| Pipeline concurrent run | 5 min polling | _pipelineRunning wait loop |
| Watchdog stuck check | 30 min | MAX_RUNNING_DURATION_MS |

### Retry Policy

| Error Type | Retryable | Max Retries | Backoff |
|------------|-----------|-------------|---------|
| transient (timeout, 429, empty) | ✓ | 2 (LLM), 1 (capability) | 3s linear |
| infrastructure (5xx, network) | ✓ | 2 (LLM), 1 (capability) | 3s linear |
| application (400, logic) | ✗ | 0 | — |
| config (401/403, no key) | ✗ | 0 | — |
| terminal (abort, cancel) | ✗ | 0 | — |

### Browser Resource Lifecycle

1. Browser launched on first browser tool call (lazy via SDK)
2. Browser stays alive between turns (BROWSER_IDLE_MS=0)
3. On session 'done': closeBrowser() → bridge.suspend() → service.dispose() → browser.close()
4. On session stop: controller.abort() + closeBrowser()
5. On mission stop: controller.abort() + closeBrowser()
6. On process shutdown (SIGINT/SIGTERM): abort all controllers, close all browsers

### State Transitions

```
created → running → completed (success path)
created → running → failed (agent error)
created → running → aborted (user stop)
running → interrupted (watchdog or restart)
```

Terminal states (no transitions out): completed, failed, aborted

### Known Risks

1. **dev_intelligence sequential LLM calls** — processes findings one by one,
   can exceed the 180s capability timeout for sessions with many findings.
   The timeout correctly bounds this; the capability is marked as failed.

2. **Pipeline takes >5 min when LLM is slow** — each LLM-calling capability
   can retry, adding 3s+ per retry. This is the expected reliability tradeoff.

3. **Zombie Chromium processes** — Chromium child processes become zombies
   when re-parented to PID 1. The container init system doesn't reap them.
   Phase 1 fix ensures service.dispose() always runs, reducing zombies from
   ~15-20 per mission to ~2 per mission. Residual zombies are an environment
   artifact (no zombie reaper in drytis-init).

4. **JSON file persistence** — no transactions. If process crashes mid-write,
   atomicWrite prevents corruption (temp + rename pattern).

5. **Single process** — all sessions share one Node.js process. Memory
   pressure under concurrency could cause OOM. Mitigated by browser cleanup
   on session completion.
