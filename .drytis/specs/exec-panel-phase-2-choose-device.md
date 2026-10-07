# Exec Panel Phase 2 · Choose Device form layout + rendering fixes

## Goal
Fix the Choose Device rendering per spec: form-style expanded state (Device /
OS version / Browser / Execution selects), no clipping/overlap/dropdown issues,
device list scrolls internally, and the collapsed row stays a single compact line.
Choose Device remains the PRIMARY selector; Change Device anywhere opens the SAME
inline section (or the same dialog picker) — one source of truth (already true via
activeTestEnvStore; verify, don't rebuild).

## Structure (expanded)
```
Choose Device                                    ▲
Device      [ iPhone 17 Pro Max ▾ ]
OS / Version [ iOS 26.0 ▾ ]
Browser     [ Safari 26.0 ▾ ]
Execution   [ REAL DEVICE ▾ ]
```
- Device select lists all catalog devices (grouped optgroups Apple/Android/Windows).
- OS version + Browser selects show only combinations that actually exist
  (reuse buildDeviceCards / browsersForOS / resolveDeviceEnvironment).
- Execution select: honest levels available for the device (SIMULATED / VIRTUAL /
  REAL only when the runtime board attests them); changes re-resolve the env.
- Keep the search + platform/type chips ONLY if space allows; preferred form is the
  four selects above (they can replace the card list; the card list may stay under a
  "Browse all devices" disclosure if it simplifies). Decide by what renders cleanly;
  the four fields are the requirement, the card list is optional.
- Expanded state pushes the preview down naturally (normal flow — already true via
  grid rows); NEVER overlaps it.

## Rendering fixes to verify (inspect actual DOM)
- Full width of the panel for selects; consistent field spacing (one grid, gap 8–10px).
- Native selects → no z-index/stacking issues; must not be clipped by viewer panel
  (viewer must NOT have overflow:hidden on ancestors of the selects).
- Collapsed row: single line, < 60px, summary + badge + Change Device + chevron.
- No horizontal overflow at 1024×768; long device names wrap/ellipsis, not clip.
- Expanded section does not retain excessive height when collapsed (body hidden).

## Files to change
- `public/index.html` (#cd-body controls markup), `public/styles.css` (.cd-* form
  grid), `public/app.js` (renderCdSecondary → full form controller; keep cdSelect/
  cdReselect store path).

## Acceptance criteria
- [ ] Expanded shows Device / OS / Version / Browser / Execution selects in one
      aligned form; selecting any of them updates preview, device card, and dialogs
      immediately (same store).
- [ ] No clipped/overlapping controls, no dropdown clipped by the panel at any of
      the six resolutions; device list (if kept) scrolls internally.
- [ ] Collapsed stays one compact line; expanding pushes preview down without overlap.

## Tests
- Acceptance suite T16 extended: form fields present, each select drives the store,
  badge honesty (header badge == clicked/selected card level).
- Responsive suite: no horizontal overflow with section expanded at 1024×768.

## Edge cases
- Device with one OS version / one browser → selects still render (disabled or
  single-option, never broken).
- No runtime board → Execution select offers only levels honest for the env.
- Catalog fetch error → honest error state (dataState) in the form.
