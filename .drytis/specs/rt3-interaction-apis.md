# RT3 · Touch, orientation & real device interaction APIs

## Goal
The agent can genuinely interact with the actual environment using device-appropriate input: touch gestures, keyboard, mouse, drag, upload/download, navigation, orientation change — executed against the live context, not simulated in page JS.

## Work
1. **Pointer/touch API** (`browserBridge.js`): add `tap`, `longPress`, `swipe` (touch), `dragTo`, `mouseMove/click/down/up` for desktop contexts; input mode chosen by context `hasTouch` (touch context → Playwright touchscreen API; mouse context → mouse API). Real Playwright input injection — no synthetic DOM events.
2. **Orientation change** (`browserBridge.js`): live viewport rotation for touch contexts (portrait↔landscape swap of viewport dims + `devicePosture` where supported), recorded in runtime facts; static launch orientation preserved.
3. **Tool exposure** (`browserTools.js`, prompts): extend the interaction vocabulary available to the agent (tap/swipe/long-press/orientation) with honest per-context availability (e.g., swipe unavailable in mouse-only context returns a clear error, not a fake success).
4. **Device-interaction fixture page** (extend `server/defectFixtures.js` demo pages): one page exercising all gestures (tap target, swipe carousel, long-press menu, drag-sort list, upload, download link) so workflows can prove gesture execution from the actual environment.

## Tests
- Bridge unit tests with a stubbed Playwright context: touch context routes to touchscreen API; mouse context rejects tap with a clear error.
- Fixture verification run: a scripted workflow performs tap/swipe/long-press/drag on the fixture page and each gesture is evidenced by DOM state change recorded from the page.

## Edge cases
- Element not tappable (offscreen) → error with position info, never a silent pass.
- Orientation change on non-touch env → SKIPPED with reason, not an error.
- Gestures on slow pages → retry within budget, honest timeout error otherwise.

## Acceptance criteria (running app)
- [ ] A run on a touch profile uses real touch injection for taps/swipes and the evidence (DOM state) comes from the page the environment actually loaded.
- [ ] Orientation change is observable in the recorded runtime facts/viewport for the session.
- [ ] Mouse-only contexts get click/drag/keyboard; touch gestures report unavailable rather than pretending.
