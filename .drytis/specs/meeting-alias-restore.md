# Restore studio→meeting room alias (meeting + microphone testing regression)

Ticket: #11283. User report: "The agent is not testing meeting links,
microphone, and other features."

## Root cause

The Sep-15 bulk rollback (`1c4eb30` reverting `01591df`) also removed the
studio→meeting **target alias** from `browserPolicy.isTopLevelAllowed`. Runs
targeting `https://studio.drytis.ai/meeting/mtg-…` redirect to
`https://meeting.drytis.dev/meeting/mtg-…`, where every action — including
`bridge.media`'s `evaluateNavigation(page.url())` pre-check (`browserBridge.js`)
— was blocked with `BROWSER_OUT_OF_SCOPE_NAVIGATION`. Session evidence showed
repeated blocked `browser_media set_permission/inspect` and `Continue as Guest`
clicks. The media stack itself was intact and the agent did plan the tests.

## Restored (exactly the 01591df hunks for this issue, nothing else)

1. `server/browserPolicy.js` — in `isTopLevelAllowed`: a declared
   `https://studio.drytis.ai/meeting/mtg-<id>` target authorizes ONLY the
   same room path on `https://meeting.drytis.dev` (exact pathname match; the
   origin, other rooms, and other paths stay blocked).
2. `server/browserWorkflowPrompt.js` — agent guidance: the alias is supported;
   guest-entry buttons are ordinary clicks (the meeting-link tool needs a
   visible anchor); the alias doesn't authorize other rooms/paths.
3. `server/drytisMeeting.integration.test.js` — restored byte-identical to
   01591df (guest button → alias allowed, redirect → alias allowed, new tab to
   alias allowed, other rooms/destinations blocked). Opt-in via
   `QASE_RUN_BROWSER_TESTS=1`.

NOT restored (intentionally, per the user's earlier rollback instruction):
fail-closed auth store, hex nonce in `drytisTransport.js`, SSRF default-on.

## Added

- `server/browserPolicy.test.js` — unit test: alias grants only the exact same
  room (with guest query); different room / other path / bare origin / non-
  meeting studio target all remain `OUT_OF_SCOPE_NAVIGATION`.

## Acceptance criteria (all verified)

- [x] Policy: same-room alias allowed; other rooms/paths/origin blocked (unit + integration).
- [x] `browser_media` inspect/set_permission/probe work while on the alias page (live E2E).
- [x] Guest-button click allowed on the alias page (live E2E: name fill + click → 68-element in-meeting page).
- [x] Integration test restored, passing under `QASE_RUN_BROWSER_TESTS=1` (3/3).
- [x] Full suite green: 476 tests, 467 pass / 0 fail (9 skips = opt-in integration).
- [x] Live E2E: QA run vs studio.drytis.ai meeting → guest join, mic permission+probe
      ("captured", audioTracks), zero OUT_OF_SCOPE blocks, report published (verdict pass).
- [x] No other behavior changed: only the three restored hunks + one unit test.
