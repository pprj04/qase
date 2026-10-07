# WebKit/MiniBrowser runtime deps on Debian trixie (found while wiring #14937)

`npx playwright install-deps webkit` does NOT install everything the
minibrowser-wpe binary needs on this image. Symptom: matrix Safari items /
defectFixtures webkit tests fail with
`browserType.launch: Target page, context or browser has been closed`
and the raw pw_run.sh run shows `cannot open shared object file` for:

libgstreamer-1.0.so.0, libflite.so.1, libjxl.so.0.11, libharfbuzz-icu.so.0,
libenchant-2.so.2, libmanette-0.2.so.0, libhyphen.so.0, libsecret-1.so.0
(+libgtk-4-1)

Fixed set (in the setup script as WEBKIT_EXTRA_DEPS + MEDIA_DEPS):
libgstreamer1.0-0 libgstreamer-plugins-base1.0-0 libgstreamer-plugins-bad1.0-0
gstreamer1.0-plugins-base libflite1 libjxl0.11 libharfbuzz-icu0
libenchant-2-2 libmanette-0.2-0 libwoff1 libhyphen0 libxkbfile1 libxtst6
libgtk-4-1 libsecret-1-0

NOTE: apt-get update may be required first on a fresh container before these
package names resolve (E: Unable to locate package on a stale index).

These are SYSTEM packages — lost on every container replacement. The setup
script re-installs them on boot; after a manual restart_container on dev,
re-run the apt line (or the setup script) before browser tests.

Verify: `bash ~/.cache/ms-playwright/webkit-*/pw_run.sh --headless --no-startup-window`
must print nothing (exit silently) — then playwright webkit.launch works.