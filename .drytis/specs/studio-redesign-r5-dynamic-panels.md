# Studio Redesign R5 · Dynamic panels (follow-ups, Drytis board, analytics, pickers)

Ticket: #13960. Builds on R1–R4 + U1–U2.

## Goal
Studio treatment for the dynamically rendered surfaces: follow-ups panel ("test these next"), Drytis board push panel, analytics summary surfaces, device/environment pickers and dropdowns rendered by JS.

## Files
- `public/styles.css` — terminal-layer selectors for: `.follow-up*`, `.drytis-board*`, analytics list/cards, `.device-drawer*`, select/dropdown chrome inside modals (device matrix, test cases, bulk runs use `.modal` already reskinned in R3).
- No HTML/JS structure changes unless a seam test pins something broken.

## Acceptance criteria
- [ ] Follow-ups panel: Studio card list, checkbox rows readable, "Run these tests" CTA matches primary button system.
- [ ] Drytis board push panel: white card surfaces, zinc borders, accept-all affordance styled like other primary actions.
- [ ] Analytics surfaces (summary list rendered into perf/feedback panel): sans text, Studio badges.
- [ ] Picker/drawer chrome: light surfaces, blue focus states, no clipped options at 1440×900.
- [ ] All colors via project tokens so dark mode flips correctly (R4 lesson: no `--surface`, use `--surface-1/2/3`).
- [ ] Seam tests stay green; full verify ≥ 849 pass / 0 fail.
- [ ] Headless signed-in screenshots light + dark, zero clipped elements in these panels.

## Tests
- Full `npm run verify`; headless checks of `.follow-up`, `.drytis-board`, drawer open state, both color schemes.
