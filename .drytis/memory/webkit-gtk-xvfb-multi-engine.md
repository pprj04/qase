# WebKit (Safari engine) via GTK MiniBrowser + Xvfb — Phase 8

Playwright's WPE headless webkit build segfaults (null ip, libWPEWebKit) in
GPU-less containers — microsoft/playwright#13875, #42940. Working approach
(verified live through the bridge, all 6 integration tests):

- Launch `webkit` with `executablePath` = bundled
  `${PLAYWRIGHT_BROWSERS_PATH}/webkit-2336/minibrowser-gtk/MiniBrowser`,
  env `DISPLAY=:77` (Xvfb spawned unref'd by `ensureXvfb`, `-nolisten tcp`)
  and `LD_LIBRARY_PATH=minibrowser-gtk/lib:minibrowser-gtk/sys/lib`.
- Debian 13 trixie deps actually needed (container may lose them on rebuild —
  recheck with ldd on the MiniBrowser binary):
  xvfb libflite1 libjxl0.11 libharfbuzz-icu0 libmanette-0.2-0 libenchant-2-2
  libhyphen0 libsecret-1-0 libwayland-egl1 libepoxy0 libgtk-4-1
  libgstreamer1.0-0 libgstreamer-plugins-base1.0-0 libgstreamer-plugins-bad1.0-0
  libgraphene-1.0-0
  (libx264-167 does NOT exist on trixie; Dockerfile pins 164.)
- Setup script installs the same set on deploy. CI (.github/workflows/verify.yml)
  still installs chromium only — firefox/webkit live tests are local-only.

Registry: server/browserEngines.js (`resolveEngine`, availability reasons for
/api/engines). Bridge seam: browserBridge.js ensureContext. Run titles are
engine-tagged server-side ("host (firefox)"); findings carry an engine field.
Known follow-up gaps (reviewer WARNs, non-blocking): postgres runRepository
doesn't persist engine/device columns; ensureXvfb treats a stale
/tmp/.X77-lock as ready.