# Exec layout · Collapsible Choose Device above preview (ticket #14069)

## Goal
A single collapsible Choose Device section at the top of the center
execution workspace (above the preview), fixing the current rendering
defects. One picker, one source of truth (activeTestEnvironment). The right
panel stays a compact current-device indicator.

## Structure
Inside `main.panel.chat`, new row between `#question-slot` and `#stage`:

```
<section class="choose-device" id="choose-device">
  collapsed header (button): "Choose Device" + summary
    device · OS/version · browser/version · execution badge + chevron
  expanded body (hidden until open): the device picker inline panel
</section>
```

- Collapsed: one compact row (~44px) + [Change Device] button; header click
  toggles expanded (aria-expanded).
- Expanded: full selection controls — reuse the EXISTING #device-picker
  dialog? No: per request "keep all controls inside this single section".
  Implementation: inline panel that hosts the same card list rendered by
  `createDevicePicker` — we reuse its pure helpers (buildDeviceCards,
  filterDeviceCards, browsersForOS, resolveDeviceEnvironment) to render an
  INLINE picker body; [Select] uses the same resolve+store path as the
  dialog picker. The #device-picker dialog stays for the OTHER entry points
  (right panel, test cases, bulk runs) — SAME selection state either way.
- Height from content; `.choose-device-body` max-height clamp +
  overflow-y:auto so a long catalog scrolls inside, never expands the page.
- z-index: the section sits above the stage in DOM; any popover/dropdown it
  opens renders with z-index above the stage overlay.

## Files
- public/index.html — section markup above #stage.
- public/styles.css — .cd-* styles, chevron rotation, expanded body scroll,
  responsive (1024 safe).
- public/app.js — toggle wiring, summary renderer from
  activeTestEnvStore/activeRuntimeEnvironment, inline picker render using
  devicePicker module helpers; onSelect → same reselect/store path.
- public/devicePicker.js — export helpers already public; add
  `renderInlinePicker({host, picker, onCollapse})` controller reusing the
  live dialog instance's data (state.environments).
- scripts/test-acceptance.mjs — extend: toggle, select → summary updates,
  preview header updates, selection preserved after tab switch + reload.

## Acceptance criteria
- [ ] Collapsed header compact: 'Choose Device' + 'iPhone 17 Pro Max · iOS
      26 · Safari 26 · REAL DEVICE' style summary + chevron toggle.
- [ ] Expanded: device/OS/browser/execution selection inline; selecting
      updates summary immediately, auto-resolves environment, preview
      updates, section collapses back.
- [ ] Long catalog scrolls inside; no page growth; no clipping/overlap/
      z-index issues vs the preview.
- [ ] Right panel remains indicator-only (Change Device → same picker).
- [ ] Selection preserved across tab switches and reload.
- [ ] All 6 resolutions clean; responsive + acceptance suites green.

## Tests
- Acceptance suite extensions + full regression.
