# RT upgrade (combine NI01–NI04 into real-time device system) — plan

Board tickets wipe to stale legacy list (platform bug) — NI tickets #14647–#14653 exist server-side; move_ticket on 'missing' ids succeeds.

## Request essence
Every device/browser genuinely executable on QASE's OWN infra (NO BrowserStack/external providers); honest Unavailable/NOT SUPPORTED with reasons; never Passed for unrun; automatic phone/tablet/desktop execution of shared workflows; health checks; touch/orientation APIs; camera/mic/screen-share testing; session/evidence isolation; coverage state vocabulary; validation + published demo-blocking gaps. Keep existing structure/UI.

## Infra reality (researcher recon, saved as real-runtime-upgrade-recon.md by researcher)
- Installed: Playwright chromium-1234 (Chrome 151 for testing), firefox-1538, webkit-2336, ffmpeg; /usr/bin/google-chrome 151 (REAL branded Chrome, currently UNUSED by code); no Edge/Opera/Brave/DDG/Firefox branded binaries.
- Edge/Brave/Opera: Chromium-based .deb installs + Playwright executablePath = genuinely real branded execution possible.
- DuckDuckGo: no Linux desktop build, no automation → NOT_SUPPORTED everywhere (correct already).
- Safari local = WebKit ENGINE_EQUIVALENT honestly; no macOS host.
- Physical iOS/Android/Windows/macOS hardware impossible in container → those environments must be UNAVAILABLE with reason (honesty contract; deviceRuntime already has this vocabulary + RUNTIME_PLACEHOLDER).
- browserSupportResolution.js static today — needs runtime-fed local column.
- Media: mic probe exists (browserMedia.js, Chromium synthetic only); NO camera/screen-share probes.
- Interactions: click/hover/fill/check/select/upload/pressKey/scroll exist; NO tap/swipe/long-press/drag/dragTo/orientation-change APIs.
- runtimeIdentity.js already detects real browser brand/version from live UA + blocks mismatch; runtime_facts persisted per run.
- Board statuses: AVAILABLE|BUSY|OFFLINE from deviceRuntime manager; needs PREPARING/RUNNING/ERROR/UNAVAILABLE + probe-fed.
- BrowserStack provider must be demoted from default registry (availability must not depend on remote).
- No pre-execution health gate exists; cellHeartbeat/capacityEvidence are unrelated.
- Bulk: client-side per-pair session loop (app.js launchPairs) + matrixOrchestrator server-side (MAX 2 concurrent).

## Phase specs (written to .drytis/specs/)
rt1-local-browser-runtime.md — local browser registry/probes (.deb installs Edge/Brave/Opera), branded launches, support resolution runtime-fed, BrowserStack demotion, DDG resolution, Safari honesty.
rt2-health-availability.md — environmentHealth.js probes, board vocabulary AVAILABLE/PREPARING/RUNNING/BUSY/OFFLINE/ERROR/UNAVAILABLE, pre-execution gate in orchestrator + session start.
rt3-interaction-apis.md — tap/longPress/swipe/dragTo/mouse, live orientation change, tool exposure, gesture fixture page.
rt4-media-permissions.md — camera probe (Chromium fake-media flags = real browser capability), screen-share probe (getDisplayMedia), permission grant/deny/recovery, call controls, honest UNAVAILABLE for engines without support.
rt5-isolation-evidence.md — per-session video recording, evidence provenance stamping, findings env context, coverage state vocabulary (Passed/Failed/Env Unavailable/Browser Unavailable/Execution Failed/Device Offline/Not Selected/Not Supported), bulk isolation audit.
rt6-validation-gaps.md — automatic default-matrix execution on real binaries, representative+fixture verification, scripts/rt-validation.mjs, demo-blocking gap publication from real data.

## Honesty posture (told to user)
Real execution = real browser binaries on this host (Chrome/Edge/Firefox/WebKit/Brave/Opera if installed); physical devices honestly UNAVAILABLE; DDG NOT_SUPPORTED; never fake, never unrun=Passed.
