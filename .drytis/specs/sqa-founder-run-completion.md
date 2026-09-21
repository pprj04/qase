# #10638 Productionize SQA and Founder Mode run completion

## Problem

SQA and Founder Mode are long, multi-phase agent runs. A provider disconnect,
container restart, or model turn ending before the mode finalizer can leave the
run interrupted or repeatedly continuing without a durable final artifact.
Generic QA behavior must remain unchanged.

## Scope

- Harden only `sqa` and `founder` lifecycle/recovery behavior.
- Preserve evidence, plan progress, interruption accounting, and owner context.
- Treat an SQA assessment as complete only after `finish_sqa_assessment` has
  durably finalized it; treat a Founder review as complete only after
  `finish_founder_review` has durably finalized it.
- Do not modify QA prompts, tools, completion behavior, or reports.

## Acceptance criteria

- [x] An interrupted SQA or Founder run is eligible for bounded automatic
      recovery when its final artifact has not been finalized.
- [x] Recovery instructions are mode-specific, name the required finalizer,
      preserve recorded evidence, and prohibit repeating finished work.
- [x] A recoverable provider interruption during SQA/Founder execution remains
      active and continues automatically instead of becoming a terminal error.
- [x] Recovery is bounded, cancellation remains effective, and exhausted runs
      fail visibly rather than looping forever.
- [x] Successful SQA/Founder publication immediately ends the model stream,
      persists `done`, and clears recovery state/snapshots.
- [x] Existing QA lifecycle behavior is unchanged and covered by a regression
      assertion.
- [x] Focused unit/integration tests and the full automated suite pass.
- [x] The managed service, root proxy, and public preview are healthy.

## Test plan

- Unit: mode-specific recovery instruction and resumability matrices.
- Integration: retryable mid-run provider interruption for SQA and Founder,
  including finalizer publication and terminal state.
- Regression: the equivalent QA provider interruption follows its existing
  lifecycle unchanged.
- Full suite and live health checks.

## Verification

- Focused lifecycle suites: 41 tests passed, 0 failed.
- Full `npm run verify`: 500 tests, 491 passed, 9 intentionally skipped,
  0 failed; syntax, private-path, and credential scans passed.
- Managed Node service restarted under `procmgr`; service and Caddy report
  `RUNNING`.
- Local `/healthz` returned HTTP 200. The public preview returned HTTP 200 and
  body `OK` through the root proxy (the edge closes the response without a
  content-length header, which makes curl report an EOF after receiving the
  complete 200 response).
