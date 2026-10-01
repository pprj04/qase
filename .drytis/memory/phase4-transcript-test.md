# Phase 4 transcript/composer browser test (ticket #14026) — 2026-10-01

Preview: /app-react/ on qase-2-1-jywqe4.drytis.dev. Run selected: d415f567 (72-message demo QA run).

## Critical bug: message bodies render EMPTY for snapshot-loaded messages
- GET /api/sessions/:id returns full `messages[]` with real `text` fields (verified in response body).
- DOM shows correct structure: `<div class="msg msg--agent" data-message-id="..."><span class="msg-role">Qase</span><div class="msg-body md"></div></div>` — but `.msg-body` is EMPTY for every server-loaded message (72/72 empty, 0 non-empty).
- A message composed locally in the session ("verify composer input", sent accidentally) DID render its body — so the component works for store-appended messages but not for snapshot-hydrated ones. Suspect: snapshot mapping writes text to a different field than the renderer reads (e.g. `body` vs `text`), or markdown renderer returns empty on those.

## Second bug: transcript viewport is 48px tall (severely clipped)
- `.transcript` clientHeight=48, scrollHeight=4386; parent `.conversation-live` height=108. Content scrolls mechanically (scrollTop settable, persists at 1000/4338) but only ~1 row visible at a time. Parent chain: conversation(108) > shell-body(640) — the conversation column is not flexing to fill height.
- Also present BEFORE any message was sent (empty state run also h=48), so not caused by the composer.

## Accidental send during test (disclose to leader)
- Pressed bare Enter while testing Shift+Enter behavior → POST /api/sessions/4f948dc6…/message → 200 sent "verify composer input\nsecond line after shift-enter\nthird line" to the example.org run. That run's agent replied. Real data modified on a low-stakes example.org run.

## What passed
- Run selection swaps transcript (72 msgs ↔ 1 msg) and aria-current follows.
- Shift+Enter inserts newline, no send; bare Enter sends; Send disabled when empty.
- No thinking strip on terminal (status=done) run; thinking strip appeared when the accidental message made a run active.
- Console: only the known favicon 404.
