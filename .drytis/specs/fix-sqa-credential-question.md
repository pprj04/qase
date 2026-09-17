# #10638 Fix SQA credential handoff

The SQA agent correctly pauses when authenticated workflows require access, but
its question uses the natural plural word `credentials`. The host's credential
detector only recognizes singular `credential`, so the dashboard renders a
normal decision form instead of the secure credential-vault form. Choosing
"Use vaulted credentials" therefore resumes the model without storing any
credentials and can strand the assessment in a repeated question loop.

## Acceptance criteria

- [x] Questions that ask for `credentials` are classified as credential input.
- [x] The same classification applies when only an option label mentions
      `credentials`.
- [x] Existing singular credential, username, password, and ordinary decision
      question behavior remains unchanged.
- [x] The SQA question renders the secure, non-echoing credential-vault form
      and can resume through the existing `/credentials` endpoint.
- [x] Focused tests and the full automated suite pass (482 passed, 9 skipped,
      0 failed).
- [x] The live service and root proxy are healthy after activation. Independent
      browser verification passed against the active frontend assets with the
      exact legacy persisted-question shape and a non-credential control case.

## Scope

This is a surgical classification fix in the shared question normalization
boundary plus regression coverage. It does not change the SQA catalog,
assessment rules, credentials storage, environment, schema, or dependencies.

## Follow-up: bound browser work after credential handoff

The 2026-09-17 customer run proved the credential handoff now succeeds, but the
authenticated assessment remained `running` for nearly two hours. Its durable
activity log contains 371 browser calls, including 133 screenshots and 129 key
presses. Obscured controls waited for the browser driver's full 30-second
timeout, while coordinate guesses and repeated keyboard traversal kept
producing successful-looking activity without completing the control plan.

### Follow-up acceptance criteria

- [x] The SQA prompt reports a live, configurable browser-tool budget and tells
      the agent to stop browser work, block unsupported coverage, and finalize
      when it is exhausted.
- [x] The host rejects SQA browser calls once the hard budget is exhausted, but
      keeps evidence-recording, blocker-recording, and finalization tools
      available.
- [x] Keyboard traversal is explicitly bounded per workflow and a failed target
      gets at most two verified locator strategies before it is recorded and
      the plan continues.
- [x] Ambiguous locators and controls obscured by an overlay fail preflight
      quickly with actionable machine-readable errors instead of consuming the
      browser driver's 30-second timeout.
- [x] Focused regressions, the full automated suite, infrastructure checks,
      independent review, and live browser verification pass.

Validation: `npm run verify` passed (493 tests: 484 passed, 9 skipped), including
budget enforcement plus delayed, missing, ambiguous, obscured, and disabled
control regressions. Independent review and post-fix infrastructure verification
passed. Cache-busted live Chromium returned HTTP 200 with no page errors. The
reported stranded run is now durably awaiting input with zero running activities
and has performed no browser action since 03:34:58 UTC; the fresh unauthenticated
browser could not inspect its private dashboard. The separate browser-efficiency
script still has a pre-existing open/frame-start race before click handling and
is not a regression from this change.
