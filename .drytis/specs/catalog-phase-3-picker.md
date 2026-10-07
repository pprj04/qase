# Phase 3 · Picker surface: sidebar taxonomy, favorites, filters, card fields

Goal: extend the existing `#device-picker` dialog to match the reference layout — left category sidebar (Favorites, Recent Tests, iOS, Android, Windows, Mac with expandable manufacturer groups), multi-column device panel, richer card fields, execution-type filter — **in existing `dp-*` styling; no new design system, no changes outside the dialog.**

## UI additions (inside #device-picker only)

### Left category sidebar (new `#dp-rail`)
- Sections: **Favorites**, **Recent Tests**, then OS platforms: **iOS, Android, Windows, Mac** — each expandable to manufacturer groups (server already exposes manufacturer categories in `deviceCatalogSeed`; facets endpoint provides counts).
- Selecting a category filters the card grid; existing platform/device-type chips remain and compose with it.
- Recent Tests: last N (10) environment selections from the active store, persisted in localStorage (`qase.recentTestDevices`), updated on each confirmed selection.

### Favorites
- Star icon per card (`#dp-star`) toggling favorite (envId list in localStorage `qase.favoriteDevices`). Favorites category shows starred cards first in selection order.
- Add/remove persists across reloads; star state survives re-renders and category switches.

### Cards (`dp-card` — same visual language, added rows)
- Fields: star, device name, `osVersion · browser browserVersion`, availability dot+label, execution type label (SIMULATED / REAL DEVICE / VIRTUAL DEVICE / EMULATOR).
- Execution vocabulary: map `VIRTUAL_DEVICE` → display 'VIRTUAL MACHINE' where it denotes a cloud VM form factor; keep distinct from device-emulator cases. Labels derive ONLY from attested/requested levels (existing `activeRuntimeEnvironment` rules) — never from assumptions.

### Filters
- New execution-type filter chips: All / Real device / Simulated / VM / Emulator (filters on resolved execution level; empty categories show an honest empty state).
- Existing platform + device-type chips unchanged.

### Search
- Extend haystack to manufacturer and full browser-version list (devicePicker `filterDeviceCards` already covers browsers; add `manufacturer` and `os` label). Results update instantly on input (existing behavior).

## Rules
- No changes to app layout, navigation, dialogs other than #device-picker, or run-start flows; selection flow (single + add-mode multi-select) unchanged.
- All new markup styled with existing tokens/`dp-*` classes; dialog must still fit viewport (existing `.dp-modal` sizing).
- Accessibility: rail is a nav with aria-current on active category; stars are buttons with aria-pressed.

## Tests
- Unit: favorites/recents store, category tree building from facets, filter composition, execution-label mapping (incl. honesty: no REAL label without attested level).
- Playwright (extend test:acceptance): star a device → appears under Favorites after reload; recents update after a selection; execution filter narrows correctly; search 'Xperia' finds Sony cards; dialog opens from existing entry points unchanged.

## Edge cases
- Favorites referencing deactivated/renamed envIds → dropped from the rail with console-safe handling.
- 1024px dialog width: rail collapses to a horizontal scroll strip (existing responsive rules; verify no clipping — recall #14125).
