# Phase A — Auto-generation engine (post-run hook → test cases)

## Goal
When a QA run completes (report published), the agent automatically generates test cases derived from that run (plan, findings, target, environment) and adds them to the Test Cases panel. Manual creation keeps working unchanged.

## Design
- New module `server/testCaseAutogen.js` exporting `createTestCaseAutogen({ testCases, config, fetchImpl, logger })` with `async generateForSession(session)`.
- Trigger: subscribe to the run bus in `serviceFactory.js` (via `watchRunBus` / `runStore.subscribeGlobal`) — react to the `report` commit event only (single fire per run), skip error/idle/stopped runs.
- Input assembly from the session: `targetUrl`, `report.verdict/summary`, `todos` (plan), `findings` (title/severity/actual/expected), `environmentSnapshot` (device/OS/browser), `testCaseSnapshot` (source case if the run was launched from one — do NOT regenerate duplicates of it).
- Generation strategy, in order:
  1. **LLM path**: one OpenAI-compatible chat completion (provider/baseUrl/apiKey/model from `server/config.js` `getConfig()`), prompt asking for a JSON array of `{title, description, steps[], expected, tags[]}`, `response_format` json_object when supported, robust JSON extraction (strip code fences), validation against the same limits as `normalizeTestCaseInput` (clamp/repair, drop invalid entries). Timeout ~30s; failure falls through to (2).
  2. **Deterministic fallback** (no API key / LLM failure): build 1–3 template cases from the plan/findings — e.g. "Verify: <todo text>" per top todo, regression case per critical/high finding — so the feature works without credentials.
- Rules:
  - Max 5 generated cases per run (configurable `QASE_AUTOGEN_MAX_CASES`, default 5).
  - Each generated case gets `tags` including `auto` and `RUN-<sessionId>`-derived tag, plus `source: 'auto'`, `sourceRunId: sessionId`, `sourceUrl: targetUrl`.
  - Stored through the existing `testCases.create()` service (same validation, `TC-XXX` numbering, env assignment = the run's environment when present).
  - Dedup: skip a generated case when an existing non-deleted case has the same normalized title AND same `sourceRunId`; also skip generation entirely when the run came from a test case (`session.testCaseSnapshot`) unless `QASE_AUTOGEN_FROM_CASES=true`.
  - Generation failures must never fail the run or throw into the bus loop — catch, log, continue.
- Feature gate: `QASE_AUTOGEN_TESTCASES` (default `on`). Off = no generation.

## Files
- NEW `server/testCaseAutogen.js`, `server/testCaseAutogen.test.js`
- `server/serviceFactory.js` — wire subscription (local + postgres paths)
- `server/testCaseService.js` — extend record shape with `source`, `sourceRunId`, `sourceUrl` (default `manual`, backward compatible; local + postgres repo pass-through)
- `server/config.js` — autogen env settings

## Acceptance criteria (server behavior)
- [ ] A completed run with plan+findings produces generated test cases via `testCases.list()`
- [ ] Generated cases carry `source: 'auto'`, `sourceRunId`, `auto`/`RUN-*` tags, `TC-XXX` numbers
- [ ] No API key configured → deterministic fallback cases still generated
- [ ] `QASE_AUTOGEN_TESTCASES=off` → nothing generated
- [ ] Run started from an existing test case → no duplicate auto cases (unless flag)
- [ ] Failed runs / stopped runs generate nothing
- [ ] LLM returning garbage JSON → fallback path, no crash
- [ ] Generation error → run completion unaffected
- [ ] All existing tests stay green; new unit tests for generator, dedup, gating, fallback
