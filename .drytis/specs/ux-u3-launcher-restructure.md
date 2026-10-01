# UX U3 · Launcher restructure (sections, progressive disclosure, sticky CTA)

Ticket: #13991. Builds on Studio R1–R6.

## Goal
Improve the QA launcher's usability without breaking the established contract (pre-checked defaults, select-all, engine fieldset, ids): clearer visual sections, progressive disclosure of advanced options (Apple environments), sticky primary CTA in long dialogs, scrollable body.

## Files
- `public/index.html` — wrap advanced device options in a `<details class="qa-advanced">`; keep every id.
- `public/app.js` — none expected.
- `public/styles.css` — Studio section styling, sticky modal-foot, details/summary styling.

## Acceptance criteria
- [ ] Launcher sections visually grouped (Target / Device / Engines / Scope) with Studio section headers.
- [ ] Advanced device options (landscape, BrowserStack environment) collapsed by default behind a styled disclosure; all ids intact and functional when expanded.
- [ ] modal-foot sticky in dialogs whose body scrolls; CTA always reachable.
- [ ] Pre-checked defaults + select-all behavior unchanged (qaLauncher tests green).
- [ ] Full verify 849+/0 fail; headless check: open QA launcher, toggle disclosure, submit still works (dialog closes / run starts), no clipped text.
