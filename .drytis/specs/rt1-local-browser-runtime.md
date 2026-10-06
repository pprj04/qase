# RT1 · Local branded-browser runtime (no external providers)

## Goal
Every browser QASE claims to execute runs as a REAL browser binary on QASE's own infrastructure. No external device-testing provider (BrowserStack/Sauce/LambdaTest) participates in availability or execution. Browsers that cannot run here are explicitly NOT SUPPORTED/UNAVAILABLE with a recorded reason — never selectable as executable.

## Work
1. **Local browser registry** (new `server/localBrowserRegistry.js`): probe the host for real browser binaries — existing `/usr/bin/google-chrome` (151, currently unused by any code path), plus attempt installs of branded `.deb` builds for Edge, Brave, Opera (Chromium-based → launchable by Playwright chromium engine via `executablePath`). Each probe records: brand, real version (from `--version` and/or live UA), executable path, install status. Any brand that cannot be installed/probed stays absent with a reason (never faked).
2. **Launch path** (`browserEngines.js`, `browserBridge.js`): engine resolution gains branded-binary launches; the emulated device profile still supplies viewport/touch, but the BROWSER is the real binary. `runtimeIdentity` already verifies live brand+version+platform and blocks mismatches — extend it to branded channels.
3. **DuckDuckGo explicit resolution**: no Linux desktop build, no automation channel → NOT_SUPPORTED everywhere (already true); ensure reason is verbatim in catalog meta, availability, matrix gating, coverage UI.
4. **Safari honesty**: local Safari = WebKit ENGINE_EQUIVALENT (labeled as such, never "Safari native"); no macOS → no native Safari on QASE infra; recorded as such.
5. **External-provider demotion** (`serviceFactory.js`, `deviceRuntime/*`): BrowserStack removed from the default runtime registry and from availability computation. Environments whose only execution path was remote become UNAVAILABLE with reason `no local execution provider for this device`. Provider code may remain dormant but contributes nothing to statuses.
6. **`browserSupportResolution.js` becomes runtime-fed**: local column derived from probe results (chrome/edge/firefox SUPPORTED with real binaries; opera/brave SUPPORTED iff installed else NOT_SUPPORTED with reason; safari ENGINE_EQUIVALENT; duckduckgo NOT_SUPPORTED), not a static table.

## Tests
- Registry probe unit tests with stubbed executables (present/absent/version-parse).
- Resolution tests: absent brand → NOT_SUPPORTED + reason; installed brand → SUPPORTED with detected version.
- Regression: full suite green; BrowserStack-less boot seeds board honestly (all remote-only envs UNAVAILABLE with reason).

## Edge cases
- Binary present but fails to launch → SUPPORTED downgraded to UNAVAILABLE at probe time with error captured.
- Version parse failure → version "unknown (detected)", never a catalog guess.
- Probe caching (TTL) with invalidation when binaries change.

## Acceptance criteria (running app)
- [ ] A run started on Chrome/Edge launches the real branded binary and the recorded runtime browser brand/version come from the live browser, not the catalog.
- [ ] DuckDuckGo shows NOT SUPPORTED with its reason in the picker, matrix, and coverage; it is never executed, never Passed.
- [ ] With no BrowserStack credentials configured, no environment shows Available due to a remote provider, and previously remote-only environments show Unavailable with a reason.
