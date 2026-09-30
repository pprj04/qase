# Phase 10 · Device Matrix drawer (right-side Device section)

## Goal
Transform the existing feature-dock device controls into a compact environment indicator + expandable Device Matrix drawer. Collapsed: current environment card with [Change]. Expanded: overlay drawer with search, ALL/APPLE/ANDROID/WINDOWS tabs, expandable manufacturer sections, device→OS→browser drill-down, multi-select environment creation, saved environments list (run/edit/remove/set-default). Overlay only — never shrinks the workspace, no overlap with agent log, browser preview, findings, SQA, or composer.

## Current state (audited)
- Existing controls: `#device-select` + `#device-landscape` in `div.feature-device` (index.html:244-248); `deviceState` populated from `GET /api/devices`; env pref in `localStorage['qase.environmentId']`.
- Existing Device Matrix modal `#device-matrix` (Phase 3) stays for admin/catalog CRUD — the drawer is a *selection* surface, not an admin surface. Footer buttons remain.
- Default-environment storage: per-user preference via `PUT /api/profile` (authService profile.preferences) or keep client localStorage. Use profile preferences (server-side, survives devices) with localStorage mirror for instant paint.

## Files to change
- `public/index.html` — replace `div.feature-device` select with a compact indicator card (`#device-chip`: DEVICE / device name / os / ● Ready / [Change]); add `<dialog id="device-drawer">` (search input, category tabs, sections list, detail pane, selected-environment summary, saved-env list, Apply/Manage buttons).
- `public/deviceDrawer.js` (NEW) — module: state (category, search, selections), catalog fetch via existing endpoints (`/api/catalog/deviceCategories`, `/deviceModels?category_id=`, `/deviceModels/:id/osVersions`, `/browsers`, `/browsers/:id/versions`), expandable sections, multi-select checkbox list of (device × os × browser) combos with validation-driven filtering, saved-environment actions (`GET/POST/PATCH/DELETE /api/environments`, set-default via profile pref), Apply → creates selected environments (bulk endpoint) and sets the default env id.
- `public/app.js` — wire drawer (open from #device-chip [Change] and [Choose Devices] quick action), render selected/default environment into #device-chip on load and after Apply; keep `pendingEnvironmentId()` reading the same preference so run-start flows are unchanged.
- `public/styles.css` — drawer overlay styles (fixed, right-side, max-width ~420px, full-height, backdrop; z-index above panels but below modals; responsive <768px full-width), compact chip styles.
- `public/deviceDrawer.test.js` (NEW) — pure-function tests (grouping models by manufacturer, combo list building, default-env selection helpers).

## Acceptance criteria (running app)
- [ ] Right-side Device area shows a compact card: DEVICE, current device name, OS version, status dot, [Change] — no permanent large footprint; existing panels untouched.
- [ ] Clicking [Change] opens the drawer as an overlay; agent log, browser preview, findings, SQA and composer remain fully visible/usable behind it; Esc/backdrop closes it.
- [ ] Drawer shows search box and ALL/APPLE/ANDROID/WINDOWS tabs; categories expand into manufacturer/section lists (Samsung, Google Pixel, OnePlus…; Laptop/Desktop/Tablet).
- [ ] Picking a device lists only OS versions the catalog says are compatible; picking OS lists only supported browsers; invalid combos cannot be selected.
- [ ] Multiple combos can be checked (e.g. iPhone 16 Pro × iOS 18.3 × Safari/Chrome/Firefox) with a visible count ("7 environments selected"); Apply creates them and the chip shows the default (first) one.
- [ ] Saved environments section lists existing environments with Run / Edit / Remove / Set-default; default survives page reload.
- [ ] Non-technical labels throughout; technical capability fields only behind an "Advanced" disclosure (screen resolution, orientation, execution provider).
- [ ] Works at desktop and narrow widths; no horizontal scroll of the main workspace.

## Tests
- Unit: drawer helpers (grouping, combo building, count).
- API integration: bulk-create from selection; default-env profile preference round-trip.
- Manual/browser (tester): the acceptance criteria above.

## Edge cases
- Empty catalog section (a manufacturer with no models) — show "No devices yet", not a blank area.
- Search with no matches — clear empty state.
- Removing the environment that is currently the default — default falls back to none/first remaining.
- Slow catalog fetch — skeletons, no layout jump; fetch failure — inline error, drawer still closable.
