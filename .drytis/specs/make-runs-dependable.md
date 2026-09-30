# Make runs dependable — #12955

## Context
Roadmap Phase 3. Gate: runs finish, await input, or fail clearly; interrupted runs recover without repeating unsafe actions. Research report (2026-09-25) found the architecture sound (abort-based stop, bounded 120s provider idle timeout, 2-retry model layer, transcript-aware recovery) but identified concrete defects and untested paths.

## Changes (all in server/)

### Fix 1 — Transcript digest reads the wrong field (`runResume.js:89`)
`transcriptDigestFor` reads `session?.activity` (singular); the store field is `session.activities`. No-snapshot crash recovery loses ALL tool-activity summaries — the agent only sees assistant prose, weakening "do not redo" protection.
- Fix: read `session?.activities`.
- Test: unit test asserting tool summaries appear in the digest (currently absent).

### Fix 2 — Stop endpoint must stop stray browser, not just abort (`app.js:632-638`, `localServices.js:79-81`)
Today `stop()` only aborts the turn controller. If the run is NOT live (crashed/recovered/idle runtime with a resident browser), the abort is a no-op and Chromium keeps running; nothing reconciles.
- Fix: `agent.stop(sessionId)` → if no live running record, call `bridge.stopFrames()` + dispose/suspend the browser runtime so a "stop" always ends all work.
- Test: app.test.js — stop on a non-running session with live runtime disposes it (idempotent).

### Fix 3 — Stop deadline for in-flight browser actions
Abort during a click/fill waits for Playwright's default 30s timeout. Acceptable bound, but the stop path should not depend on it silently.
- Fix: in browserBridge tool context, race abort signal against Playwright action promise — on abort, force-close the page context (bridge already supports suspend); return a structured `BROWSER_STOPPED` failure so the loop unwinds immediately.
- Test: unit test with fake bridge: abort during action rejects within the abort window, not the action timeout.

### Fix 4 — browser_wait timeout clamp (`browserBridge.js`)
Schema says default 5000ms / max 30000ms, but no code-level clamp exists; an oversized model-provided `timeoutMs` stalls the run.
- Fix: clamp `timeoutMs` to [0, 30000] where browser_wait is handled.
- Test: oversized value clamped, boundary values respected.

### Fix 5 — Mechanical no-repeat guard for destructive actions (QA + Founder)
Today protection is prompt-level only. Add a per-session ledger of executed destructive-action authorizations (the browserPolicy categories), checked before re-executing an identical (tool, selector/URL) pair in the SAME session after recovery/continuation turns.
- Fix: ledger in runStore live record + session record; on repeat attempt of an already-executed destructive pair post-recovery, return a structured refusal (`ACTION_ALREADY_EXECUTED`) instructing the agent to verify instead of redo.
- Test: unit test — recovery turn attempt to re-execute a ledgered pair is refused; benign non-destructive repeats allowed.

## Acceptance criteria
- [ ] Digest includes tool summaries (Fix 1 test green)
- [ ] Stop on non-running session disposes stray browser (Fix 2 test green)
- [ ] Abort during browser action unwinds immediately (Fix 3 test green)
- [ ] browser_wait clamped (Fix 4 test green)
- [ ] Destructive-pair re-execution refused after recovery (Fix 5 test green)
- [ ] Full `npm run verify` green (501+ tests, no new flakes)
- [ ] Preview smoke: start run → stop → session idle, browser disposed; restart server → interrupted run recovers via snapshot

## Out of scope
- Post-run UI layout, token counter (Phase 4)
- SQA browser budget (already exists)
- FS-corruption platform issue (memory-documented playbook)
