# Phase 2 · Capture real provider token usage in the agent loop

## Goal
Harvest real provider-reported token usage (input/output/total/cached) during each turn, aggregate it per run, and finalize the totals when the run completes — without forking or patching `node_modules`.

## Background (from research)
- `server/agent.js` `runTurn()` (line 501) constructs a fresh `CleanSlateNodeAgentRuntime` per turn (~line 398) and drives it via `runtime.run(task, signal)`; the streamLoop (637–729) consumes parts. Terminal paths: `completeRun()` (561–575) and the catch block (779–801).
- The SDK normalizes usage (`{inputTokens, outputTokens, totalTokens, cachedInputTokens}`) and emits `{type:'usage'}` provider parts, but drops them in `CleanSlateService.parseProviderPartStream` (protocol/cleanSlateService.js:893).

## Capture strategy (two tiers, both in-repo)
1. **Instance wrapper on `parseProviderPartStream`** (primary): after constructing the runtime in `runTurn`, reach `runtime.cleanSlateService`, wrap the generator method, and harvest any `usage` parts before they're dropped. The codebase already reaches into SDK privates (`agent.js:424–427` rebinds `sdkSession.continueWithTurn`), so this follows existing precedent. Guard with `typeof svc?.parseProviderPartStream === 'function'` so a renamed private fails safe (no usage captured, run unaffected).
2. **Injectable `logger`** (secondary/fallback): pass `logger: { info, debug }` in the runtime options; parse the `[CleanSlateAzureDebug] ... reportedInputTokens=N` line (real usage, Azure) and the stage=complete `estimatedInputTokens/estimatedOutputTokens` debug line (SDK chars/4 estimate, all providers). Only apply estimates when NO real usage was captured for that turn, and mark the result `estimated: true`.

## Aggregation & finalization
- Per turn: accumulate harvested usage into `session.tokenUsage` (sum across multiple provider calls within one turn) and `runStore.commit(session, 'usage', { usage: session.tokenUsage })` — same cadence as the existing `context` commit (agent.js:667–674).
- On `completeRun()` and on the error/interrupted paths (779–801): write the finalized totals once, so a terminal run always has its last usage state persisted.
- Prefer real over estimate: if any real usage parts arrived in a turn, discard that turn's estimate.

## Provider reality (document in code comment)
- Azure OpenAI/Foundry, OpenAI Responses API, OpenRouter/NVIDIA/custom gateways: exact numbers.
- Vanilla OpenAI chat-completions (no `include_usage`) and Anthropic (`message_delta.usage` ignored by SDK): estimate fallback only.

## Acceptance criteria
- [ ] A completed run shows a `tokenUsage` with input/output/total > 0 when the provider reports usage in-stream
- [ ] When only estimates are available, `tokenUsage.estimated === true` and numbers are populated from the SDK estimate
- [ ] Runs complete normally if the SDK internals move (wrapper silently no-ops, no crash) — verify by pointing at a mock runtime without the private method
- [ ] Token totals accumulate across multiple turns in one run, not just the last turn

## Tests
- Unit test the harvest wrapper with a fake generator yielding `{type:'usage'}` parts — assert capture + passthrough of other parts.
- Unit test logger-line parsing (Azure info line, debug estimate line, garbage lines).
- Unit test aggregation (sum across parts, real-beats-estimate).
