# Phase 2 — Start QA launcher: device & browser matrix UI

## Goal
Replace the legacy three-engine fieldset (`#qa-engine-options`, Chromium/Firefox/WebKit) in
the Start QA run dialog (`public/index.html` `#qa-start`) with the full device & browser
matrix: device panel with filters, seven browser families with version lists, and a
selected-configurations summary. Preserve the dialog's existing architecture (qaUi wiring in
`public/app.js`), styling classes (`qa-engine-fieldset`, `scope-options`, `check`), and the
surrounding QA workflow (scope, tests, founder/compliance options untouched).

## Files to change
- `public/index.html` — replace BOTH duplicated `qa-engine-fieldset` blocks with one
  `qa-matrix-fieldset` (device panel + browser checklist + summary container).
- `public/app.js` — remove `selectedQaEngines()` / `syncEngineAvailability()` engine wiring;
  add matrix state: fetch `/api/qa-configurations` (loading/empty/error/retry states),
  device tree (reuse `buildSidebarTree`/`filterSidebarTree`/`buildBrowserColumns` from
  `deviceBrowserMatrix.js`), filters (platform, manufacturer, model, OS version, orientation),
  selection set with default = all available configurations, deselection persistence.
- New `public/qaConfigMatrix.js` (+ `.test.js`) — pure model layer: filtering, default
  selection (available ⇒ checked; unavailable stays visible, disabled, reason shown),
  deselection memory (`qase.qaConfigDeselections` localStorage, keyed envId), summary
  assembly (counts by platform/browser family), Start validation (URL + ≥1 selected).
- `public/styles.css` — only additive rules for the matrix panel inside the modal:
  scrollable regions (max-height with overflow-y), sticky column headers, search input;
  no clipping of controls at narrow widths.

## UI contract
- **Device panel**: platform-grouped tree (iOS incl. iPadOS, Android, Windows, macOS),
  execution-type badge per device (Physical / VM / Emulator / Simulator / Browser emulation),
  manufacturer shown (Apple rows now carry it), searchable + scrollable.
- **Browser checklist**: the seven families (order: Chrome, Edge, Firefox, Opera, Brave,
  DuckDuckGo, Safari) — a family is available for the current device/OS filter only if
  compatible environments exist; unavailable families remain visible, greyed with reason
  (e.g. DuckDuckGo's existing not_supported reason; Safari on Android/Windows "not available
  on this platform"). Unsupported combos can never be checked (checkbox disabled).
- **Versions**: per family, compatible browser versions from the catalog; selectable
  individually; newest-first.
- **Summary**: "N configurations selected" + per-family counts; synchronized with device
  selection and filters at all times.
- **Default**: every available compatible configuration is selected when QA opens;
  user deselections persist across dialog reopens (same filters) and are preserved when
  new catalog entries appear.
- **Start button**: disabled until target URL valid AND ≥1 configuration selected.
- **Catalog loading states**: loading skeleton, empty (honest empty message), error +
  Retry button (re-fetches). No silent fallback to the old engine list.

## Acceptance criteria
- [ ] All seven browser families appear in the checklist in the dialog.
- [ ] Android, Apple (iPhone/iPad/Mac) and Windows device categories are present and
      filterable by platform, manufacturer, model, OS version and orientation.
- [ ] Physical devices, VMs, emulators, simulators and browser emulation are each
      identifiable by a visible badge.
- [ ] All available compatible configurations are checked by default; explicit
      deselections persist across dialog reopens.
- [ ] The total planned configurations are shown before starting, and Start stays disabled
      without a valid URL or with zero configurations.
- [ ] Unavailable browser families stay visible with their reason and cannot be selected.
- [ ] Device-catalog loading shows distinct loading, empty, error and retry states.

## Tests
- `public/qaConfigMatrix.test.js`: default selection, deselection persistence, filter
  behavior, disabled unsupported combos, summary counts, Start validation predicate.
- DOM-level: matrix renders inside `#qa-start`, seven families present, scroll containers
  scroll (clientHeight < scrollHeight), no horizontal clipping at 1280 and 1024 widths.

## Edge cases
- Catalog fetch fails → error state with retry; Start disabled (never start with stale
  selection).
- Pagination: fetch all pages before enabling selection.
- Dialog reopened while a previous fetch is in flight → abort previous request.
- Empty search results → honest empty message, not a blank panel.
