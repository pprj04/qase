# UI Fix Phase 1 — Viewport shell & center tab workspace (P0)

Branch: NIHARIKA only. Never merge PUSHKAR's checkpoint wholesale; conflicts with origin/DEV are unresolved.

## Goal
The app shell never scrolls at the browser level; the Activity/Plan/Findings/Bugs/Report tabs move OUT of the right viewer panel INTO the center execution column as a proper workspace: Run Header → scrollable execution area → sticky tab bar → scrollable active-tab content → quick actions/command input.

## Current state (NIHARIKA, 257acfc)
- Tabs live inside right `.panel.viewer`: `#tabs` nav at index.html:238, `.tab-body` panes `#pane-activity/#pane-plan/#pane-findings/#pane-report/#pane-sqa/#pane-founder` at :247-253. **No Bugs tab exists on this branch.**
- `.app` already has height:100vh/100dvh (styles.css:149-157), grid columns `clamp(232px,15.5vw,272px) minmax(420px,0.9fr) minmax(520px,1.18fr)`.
- Tab switching toggles is-active on pre-rendered panes (app.js:4006-4019); renderers: renderActivity:1363, plan:1423, renderFindings:1446, renderReport:1596, renderSqa:1841, founderView.render.
- `.quick-actions` sits at page level (index.html:860) outside `.app`.

## Changes
1. index.html: move `#tabs` + `.tab-body` into the center `main.panel.chat` after the transcript, before the composer. Add a `#pane-bugs` section + `#tab-bugs` button (bug data already exists — BUG-XXX ids from Phase 6, #13443; render list into the pane from existing bug state/API).
2. Only the active pane renders content/visible (existing is-active pattern is fine — all panes stay in DOM, only one visible).
3. styles.css: center column becomes `display:flex; flex-direction:column; min-height:0`; execution area `flex:1 1 auto; min-height:0; overflow:auto`; tab content `flex:1 1 auto; min-height:0; overflow:auto` with a guaranteed min-height (e.g. minmax/140px floor); tab bar sticky within the workspace.
4. Quick actions strip moves INSIDE `.app` at the bottom of the center column (or stays directly under composer) — never page-level.
5. Activity pane: own scrollbar, auto-scroll-to-latest with an [Auto-scroll ON/OFF] toggle.
6. Plan items show status chips Queued/Running/Passed/Failed/Blocked (data already streamed).
7. Findings/Bugs panes: scroll inside pane; no page growth with long content.
8. Report pane stays inside workspace; [Export report] action preserved.

## Acceptance criteria (running app)
- [ ] At 1024×768 and 1920×1080 the browser page itself does not scroll (documentElement scrollHeight == clientHeight with default content).
- [ ] Tab bar is visible while any tab's content scrolls; content scrolls only inside its pane.
- [ ] Clicking each of Activity/Plan/Findings/Bugs/Report makes that tab's content occupy the workspace immediately; other panes not visible.
- [ ] A very long activity log grows only the activity pane's scrollbar, never the page.
- [ ] SQA and Founder tabs still work after relocation.
- [ ] Quick actions and command input remain reachable without scrolling.

## Tests
- Unit: tab activation logic (existing app.js tests pattern); pane visibility assertions.
- Browser: inject 500 activity items, assert documentElement doesn't overflow.

## Edge cases
- SQA auto-tab-switch (app.js:1818-1823) must survive the move; transcript/composer heights must not collapse tab content to zero on short viewports; right panel must not depend on tabs being present (Phase 3 restructures it).
