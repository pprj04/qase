# Theme Switching — Dark / Light / System Default

Source request: user spec (2026-10-02). Keep dashboard layout/structure identical; dark stays default; add Light and System Default; toggle lives in the existing Settings section; centralized CSS variables; persistence without flicker; complete coverage.

## Grounding (researcher findings, NIHARIKA)

- Stack is vanilla: `public/index.html` (1,368 lines, `<body class="cli-theme">` at L15, zero `data-theme` today), `public/app.js`, `public/styles.css` (11,822 lines).
- `styles.css` already has a token system:
  - L3–43 base `:root` dark zinc palette (`--bg`, `--surface-1..3`, `--canvas`, `--border`, `--text*`, `--accent: #2f5bea`, `--success/--warning/--danger/--critical/--info` + `*-soft`, shadows, radii).
  - L5228–5266 "Drytis Studio tokens — light-first" layer (same names, light values).
  - L5268–5312 `@media (prefers-color-scheme: dark) { :root { … } }` dark override.
- ~1,073 `var(--)` uses vs ~536 rules with hardcoded colors — leftovers like `.modal{background:#27272a}` (L2957/2984), `.field input/select{background:#202020}` (L3031), `.toast{background:#27272a}` (L6597). These break light mode; migrate to tokens.
- `bugsView.css` + `entry-terminal.css` already consume root tokens.
- Settings dialog: native `<dialog class="modal" id="settings">` in index.html L642–712; `.field` rows with `<span>` labels are the house pattern (e.g. Provider select at L650).
- localStorage convention: `qase.*` keys; best store pattern `public/activeTestEnvironment.js` (injectable storage, `memoryStorage()` fake in tests). Theme key: `qase.theme`.
- CSP `script-src 'self'` **blocks inline scripts** (lesson from reverted React work #14023): the no-flash bootstrap MUST be an external file, e.g. `public/theme-bootstrap.js`, loaded before other CSS-visible paint work.
- JS colors: `entry-motion.js` boot canvas uses hardcoded greens (boot-only, leave); `browserChrome.js` brand colors are intentional identity colors (leave); `app.js` style writes are sizes only except one already using `var(--danger)`.
- Tests: `node:test` in `public/*.test.js`, run via `npm test`. UI scripts: `npm run test:ui`.

## Decision — accent color

Request says "existing green accent"; the live accent is blue `--accent: #2f5bea` with green success/status tokens. Decision: keep the existing accent identity in both themes (do not repaint the app green); "consistent green" = the green status/success colors remain consistent across themes. Rationale: "Do not unnecessarily modify the existing dark theme."

## Phase T1 · Theme foundation (tokens, data-theme, no-flash bootstrap, store)

Goal: the theme machinery works end-to-end with no UI toggle yet.

Files:
- `public/styles.css`: restructure token layers →
  - `:root` keeps dark values (default).
  - `[data-theme="light"]` gets the light-first values (currently the unconditional light layer L5228–5266 — must become conditional, this is the risky edit; verify no selector ordering regressions).
  - `@media (prefers-color-scheme: dark)` override gated to `[data-theme="system"]` (and `:not([data-theme])` fallback = system behavior).
- `public/theme-bootstrap.js` (new, external, CSP-safe): reads `qase.theme` from localStorage, sets `document.documentElement.dataset.theme` (`light`|`dark`|`system`, default `dark`) before first paint; loaded first in `index.html` `<head>`.
- `public/themePreference.js` (new): store factory following `activeTestEnvironment.js` pattern — injectable storage, `resolve('dark'|'light'|'system')`, invalid/missing → `dark`, system → listens to `matchMedia('(prefers-color-scheme: dark)')` change and updates live.
- `public/app.js`: init store, apply attribute, keep DOM in sync.
- `public/themePreference.test.js` (new).

Acceptance criteria (running app):
- With no stored preference, dashboard renders exactly as today (dark).
- Setting `data-theme="light"` on `<html>` flips every token consumer without reload.
- `data-theme="system"` tracks OS preference live, including changes while the page is open.
- Reload with stored `qase.theme=light` shows light immediately — no flash of dark first.
- Unit tests: resolution matrix (3 modes × stored/missing/invalid), persistence round-trip, system-change propagation.

Edge cases: missing localStorage (private mode), invalid stored value, `prefers-color-scheme` unsupported, double-bootstrap guard.

## Phase T2 · Theme toggle in Settings

Goal: user-facing control.

Files:
- `public/index.html`: new `.field` inside `#settings` dialog (near Provider row, L650): `<span>Theme</span>` + `<select id="cfg-theme">` with Dark / Light / System options.
- `public/app.js`: wire select ↔ store both ways (select shows stored value on open; change applies instantly); label pattern consistent with existing fields.

Acceptance criteria (running app):
- Settings dialog contains a Theme selector with exactly three options; no new navigation.
- Choosing Light or Dark applies to the whole dashboard instantly, without reload.
- Choosing System follows the OS; reopening Settings shows the saved selection.
- Preference survives refresh and navigation between sections.

Edge cases: open Settings before store init; storage write failure (app still switches for the session).

## Phase T3 · Complete coverage & hardcoded color migration

Goal: light mode fully readable everywhere; dark unchanged.

Files: `public/styles.css` (bulk), touch-ups in `bugsView.css`/`entry-terminal.css` raw-hex leftovers, `public/app.js` if any JS-applied colors need variable awareness.

Coverage checklist (from request): main dashboard, left sidebar, recent sessions, performance metrics, execution logs, conversation messages, browser preview, device matrix, browser/version selectors, test cases, plan, activity, findings, bugs, reports, modals, dropdowns, tooltips, settings, loading/empty states, all buttons and form controls.

Approach: migrate hardcoded darks to `--surface-*`/`--bg`/`--border` tokens section by section (modals L2949+, fields L3031, toasts L6597+, command palette L6506, SQA launcher L7663, chips/badges). Keep: entry-motion boot canvas greens, browserChrome brand colors. Charts/progress bars are CSS-based and follow tokens.

Acceptance criteria (running app):
- Light mode: no unreadable text, invisible borders, or low-contrast controls anywhere in the coverage checklist.
- Dark mode pixel-comparable to pre-feature design (token values for dark unchanged).
- Both themes keep identical layout — switching causes zero element reflow/misposition.
- Status badges, tooltips, dropdown menus readable in both themes.

Edge cases: `rgba()` shadows/overlays on light bg; native `<select>` dropdown chrome on different OS; scrollbars; focus outlines.

## Phase T4 · Validation & regression

Goal: prove the request's 7 validations.

- 1: switching updates entire dashboard immediately (manual + scripted check of token flip).
- 2: dark mode identical to existing design (side-by-side comparison of key screens; no dark token values changed).
- 3: light mode readable — walk every coverage-checklist section.
- 4: persistence after refresh (both themes + system).
- 5: system default follows OS (simulate via devtools emulation + matchMedia test).
- 6: all existing functionality operational — full `npm test` suite plus `npm run test:ui` responsive scripts; note: `catalogProviderRegistry.test.js` failure is pre-existing from in-progress #14275, not caused by this work.
- 7: no layout changes — compare element geometry across themes.

Deliverable: validation report on the ticket.
