# Phase B3 — Runner-real browser versions (Latest/Previous/Older) & honest version execution

## Goal
Make multi-version selection mean something real. Today the catalog offers many majors per
family, but the local runtime has exactly ONE binary per brand — selecting "Chrome 140" vs
"Chrome 156" only changes emulation metadata, and the honest version is whatever `--version`
detected. The request requires: multiple real executable versions where the runners provide
them, versions from actual runner capabilities, and Latest/Previous/Older presentation.

## Work
- `server/localBrowserRegistry.js`: extend to probe MULTIPLE installed binaries per brand
  (versioned install paths, e.g. `/workspace/.local-browsers/<brand>-<major>/`), exposing
  `availableVersions[]` per brand with detected versions; single-binary brands keep a
  one-entry list (honest).
- `server/browserBridge.js`: launch honoring the requested major when a matching binary
  exists; when not, fall back to the single installed binary and RECORD the divergence
  (existing runtimeFacts honesty: `brandedBinary.detectedVersion` vs requested — extend with
  `versionMatch: 'exact'|'fallback'`).
- `server/qaConfigurations.js`: per-family `availableVersions` from the registry (local) or
  provider overlays (BrowserStack when configured); mark each catalog version's
  executability: exact binary, fallback binary (labeled), or emulation-only (mobile/OS rows).
  Never fabricate versions — catalog majors with no runner backing are labeled honestly.
- `public/qaConfigMatrix.js` + dialog render: within a family, show Latest / Previous / Older
  labels (from `channelForVersion`, already in `environmentCatalog.js:132–145`), and a badge
  when a requested version will actually launch a different (fallback) binary or emulation —
  visible BEFORE starting, so the user never believes chrome-140 executed when it didn't.
- BrowserStack (when credentials configured later): overlay real device browser versions
  automatically (provider already additive; connected:false today — no code change needed
  beyond what exists, verify with fixture).

## Acceptance criteria (true in running app)
- [ ] Where multiple binaries are installed per brand, each selected version launches its real binary and the result records that exact version.
- [ ] With a single binary per brand, only that version is offered as real; other catalog majors are labeled as fallback/emulation, visibly, before start.
- [ ] Latest/Previous/Older labels appear per family where version depth exists.
- [ ] DuckDuckGo shows NOT SUPPORTED with its existing reason — not a selectable fake version.
- [ ] No version number is ever displayed that lacks a runner source (registry or provider).

## Tests
- Registry: multi-binary probing, version lists, single-binary honesty.
- Bridge: requested-vs-launched version recording (`versionMatch`), fallback path.
- qaConfigurations: availableVersions assembly + honest labels.
- UI model: Latest/Previous/Older labeling, fallback badge logic.

## Edge cases
- Binary present but launch-probe fails → excluded from availableVersions (honest).
- Provider overlay adds versions → union with local, provider-tagged; provider drops →
  versions disappear on next catalog load (no stale claims).
- Setup script installs second binaries for at least one brand (e.g. a second Brave/Opera
  .deb) so multi-version execution is demonstrable.
