# Studio Redesign R3 · Auth gate + dialogs/modals

Ticket: #13958. Predecessors: R1 tokens (#13956), R2 app shell (#13957), U1 typography (#13989), U2 navigation IA (#13990) — all Done.

## Goal
Bring the entry (auth) gate and every modal/dialog surface to the Drytis Studio design language, keeping all DOM ids/classes and behaviors the seam tests pin.

## Files
- `public/entry-terminal.css` — auth gate styles (already partially reskinned in R1: verify + complete: heading scale, input rows, submit glow, error banner, mode tabs).
- `public/styles.css` — dialog/modals: `dialog` base, `.env-dialog`, `#device-matrix`, `#test-cases`, `#bulk-run`, `#quick-actions`, settings/profile dialogs, `.btn` ghost/danger variants used inside dialogs.
- `public/index.html` — no structural changes expected.

## Acceptance criteria
- [x] Auth gate: Studio light-first card, near-black submit with blue glow, zinc borders, Geist type (done in R1; regression-checked here).
- [x] All `dialog` surfaces share one Studio base: white surface, 16px radius, zinc border, Studio shadow, sans type.
- [x] Dialog headers/titles use the U1 type scale; close buttons are ghost-icon style.
- [x] Form controls inside dialogs match the U1 48px field styling (inputs, selects, textareas).
- [x] Dark-mode variant for dialogs via prefers-color-scheme (zinc #101012 surfaces).
- [ ] Zero page errors on auth gate load and after sign-in.
- [ ] All seam tests stay green (finalUiPolish, founderUi, bugsUi, entry-related).

## Tests
- Full `npm run verify` must stay at 869/849/0/20 or better.
- Headless: load `/` (auth gate screenshot), sign in, open each dialog (environments, device matrix, test cases, bulk runs, settings), screenshot each, confirm no clipped/overlapping text via DOM measurement (scrollWidth > clientWidth checks).
