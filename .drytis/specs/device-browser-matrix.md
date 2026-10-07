# Device & Browser Matrix Redesign — Phase Spec

Customer spec (2026-10-02): redesign the device/browser selection UI into a comprehensive,
searchable matrix. Extend the existing architecture — no rebuild, no API contract changes,
no replacement of real execution. Reference site: https://qase-2-1-cvtryq.drytis.dev/

## Grounding (from recon, branch NIHARIKA @ 8749e61)

- Single source of truth: `server/environmentCatalog.js` (713 lines) — PLATFORMS (5),
  BROWSERS (7, platform-restricted), BROWSER_VERSIONS (flat majors per browser),
  APPLE_DEVICES 78 / ANDROID_DEVICES 80 / WINDOWS_DEVICES 5 generic form factors,
  `isCombinationSupported()` :528, `generateEnvironments()` → 36,619 env rows,
  catalog version 2027.01.0, env capacity clamp 50,000.
- Selection UI: modal `<dialog id="device-picker">` (index.html:1336), logic in
  `public/devicePicker.js` (pure helpers + dialog factory), wiring `app.js:6303–6440`,
  consumed via `public/activeTestEnvironment.js` store (`__qaseActiveSelection`).
- Favorites/recents: NONE exist. Convention: `qase.*` localStorage keys
  (qase.theme, qase.activeTestEnvironment, …).
- Theme: token system (`:root[data-theme]` layers, `var(--text)`, `--surface-*`,
  `--border`, `--accent`, `--ease`); theme store in `public/themePreference.js`.
- Honesty contract: execution levels REAL_DEVICE / VIRTUAL_DEVICE / SIMULATED,
  provider registry PROV- rows with attestations (catalogProviderRegistry.js).
- Browsers/platforms already correct: Safari never on Android/Windows; iOS/iPadOS
  non-Safari browsers run on WebKit (documented in BROWSERS notes).
- Missing devices vs spec: Surface Pro/Laptop/Go; MacBook Air M1; MacBook Pro M1 13"
  and M2 13"; iMac 24" (M1/M4); (Mac Studio / Mac Pro / Mac mini present in part).
- No channel dimension (Stable/Beta/Dev/Canary) exists anywhere — greenfield.

## Decisions (planned, agreed with spec)

1. **Channels are derived metadata, not new env rows.** Each BROWSERS entry gains a
   `channels` array (e.g. chrome: stable/beta/dev/canary; firefox:
   stable/beta/nightly; duckduckgo: stable). `channelForVersion(browserCode, major)`
   labels the newest majors of each list per the customer's illustrative pattern
   (e.g. list top = Dev, top-1 = Beta, top-2 = Stable … exact window per browser).
   envIds and the environments table stay UNCHANGED — no 4× row explosion, backward
   compatible, catalog stays updatable by bumping version arrays. Non-stable channel
   selections surface honestly in the UI (execution provider attestation governs
   whether they are real or simulated — unchanged rules).
2. **The matrix replaces the device-picker modal body** — the existing
   `<dialog id="device-picker">` becomes the wide/full-screen matrix host. Existing
   entry points ([Change Device] buttons, add-mode multi-select for bulk runs/test
   cases) keep working: same dialog element, same `activeTestEnvironment` store,
   same `resolveDeviceEnvironment` fallbacks.
3. **Layout per the textual spec** (reference screenshot was not uploaded; the
   detailed A/B/C description in the request is the contract): (A) top bar with
   target-URL input + refresh bound to REAL existing state/actions (run URL field,
   preview reload); purely decorative nav/extension buttons are OMITTED rather than
   faked. (B) left sidebar: Favorites, Recent Tests, iOS, Android, Windows, macOS;
   per-category OS navigation; search; expand/collapse; independent scrolling;
   active highlighting; star toggles. (C) main area: one horizontal COLUMN per
   compatible browser brand — icon, name, scrollable version list, channel labels,
   favorite star per version, "More" control. Selected environment renders as
   `Device · OS · Browser Name · Browser Version · Execution Type · Availability`.
4. **Favorites & recents persist via the existing `qase.*` localStorage convention**
   (same injectable-storage pattern as themePreference.js / activeTestEnvironment.js).
   No new auth, no server schema change. Keys: `qase.matrixFavorites`,
   `qase.recentEnvironments` (capped, e.g. 10).
5. **Compatibility-aware selection reuses `isCombinationSupported()`** client-side
   (imported pure helper) — the matrix only offers existing env combinations
   (same approach as `browsersForOS()` today). Server `/api/catalog/validate` and
   422 paths remain the backstop; nothing new to invent.
6. **Icons**: inline SVG glyphs (brand-recognizable shapes, current official colors)
   shipped in the module — no external CDN (CSP), no runtime fetch.
7. **New UI uses theme tokens exclusively**; no new `[data-theme]` blocks; every
   styles.css change bumps the cache-bust version.

## Phases

### M1 — Catalog data: channels + missing devices (server)
Files: server/environmentCatalog.js, server/environmentCatalog.test.js,
scripts/validate-matrix.mjs.
- Add `channels` per BROWSERS entry + `channelForVersion()` (pure, tested).
- Add Surface Pro (9/10/11), Surface Laptop (5/6/7), Surface Go (3/4) as Windows
  device models (Win 10/11 ranges only where supported).
- Add MacBook Air M1 (Monterey–Sequoia), MacBook Pro 13" M1/M2 (Monterey–Sequoia),
  iMac 24" M1 (Monterey–Ventura) and M4 (Sonoma–Tahoe) — only compatible OS ranges.
- Catalog version bump 2027.01.0 → 2027.02.0; check env count vs 50,000 clamp and
  raise everywhere if within 20% (same clamp locations as #14273: app.js, local
  list, postgres repo, facets, 3 app.js fetches).
- Update validate-matrix.mjs static checks for channels + new device families.

### M2 — Matrix model: pure module + persistence stores (client)
Files: NEW public/deviceBrowserMatrix.js, NEW public/deviceBrowserMatrix.test.js.
- Sidebar tree derivation from the environments list + catalog: categories
  (favorites/recent recs resolved from stores), device grouping per platform,
  OS sub-navigation per device family.
- Favorites store (device envIds, browser version keys) + recents store (recently
  USED full environments) with injectable storage, cap, prune, subscribe.
- Browser-column derivation: for current platform/OS → compatible browsers with
  version lists (stable first, channels labeled, "More" windowing), per-version
  favorite keys, honest availability/execution labels.
- Selection assembly: matrix selection → canonical env record →
  activeTestEnvironment-compatible payload (reuse resolveDeviceEnvironment shapes).

### M3 — Sidebar UI in the picker dialog
Files: public/index.html, public/devicePicker.js (or new view module wired in),
public/styles.css (new matrix section), public/app.js (wiring).
- Replace dp-body card list with: sidebar (search input, category tree, OS nav,
  expand/collapse, star toggles, recent list) + main area scaffold.
- Keep dialog element, add-mode, footer summary, Change Device entry points intact.
- Independent scrolling regions, active highlighting, keyboard a11y basics.

### M4 — Top bar + browser brand columns + selection flow
Files: same as M3 + activeTestEnvironment integration.
- Top bar: target URL input bound to the real run-URL state, refresh bound to the
  real preview-reload action; no decorative fake buttons.
- Brand columns: SVG icon, name, platform-restricted visibility (never a browser
  where it cannot execute; Safari only macOS/iOS/iPadOS), scrollable version list,
  channel labels, favorite star per version, "More" control.
- Selection: device + OS + browser + version → environment summary chip
  (Device · OS · Browser · Version · Execution Type · Availability); write-through
  to activeTestEnvironment store + recents; invalid combos impossible by
  construction (only compatible offered).

### M5 — Theme coverage + responsive behavior
Files: public/styles.css (+cache-bust bump), index.html.
- Full light/dark coverage across bar, sidebar, lists, columns, stars, chips,
  empty/loading/error states — tokens only.
- Desktop: fixed sidebar + horizontal scroll columns + sticky headers. Tablet:
  collapsible sidebar, touch targets. Mobile: compact bar, scrollable columns,
  no overlaps. Desktop reference layout is not sacrificed.

### M6 — Validation & regression
Files: scripts/validate-matrix.mjs, test additions.
- Acceptance sweep vs the customer's ~24 checkboxes (categories present, search,
  OS depth, 7 brands, versions+channels, icons, favorites persist, recents work,
  selection updates matrix/env, incompatible blocked, availability honest,
  real-vs-simulated distinguished, both themes, independent scrolling, existing
  workflows intact — QA/SQA/Founder, bulk runs, saved envs, history — no console
  errors, no duplicate env creation, final UI matches the reference layout).
- Full suite green; regression on devicePicker/activeTestEnvironment tests.

## Out of scope
- Any backend/API contract change; any auth change; provider/runtime work;
  replacing the admin Device Matrix (deviceMatrixView.js) or the exec drawer.
- Faking availability or inventing real-execution claims for Beta/Dev/Canary.
