# Setup script hardened for browser deps (#14020) — root cause closed

Third occurrence of "Chromium blocked: libglib-2.0.so.0 missing" (after #12271, #14011)
prompted a root-cause fix rather than another manual apt install.

## What changed (2026-09-30, setup script via update_setup_script)
- Correct bookworm package names: libjxl0.7 (not 0.11), libx264-164 (not 163), plus the
  previously-missing libx11-xcb1 libxcursor1 libgtk-3-0 libpangocairo-1.0-0
  libcairo-gobject2 libgdk-pixbuf-2.0-0 libwebpdemux2 libwebpmux3 libgles2 libatomic1
  libopus0.
- HARD VERIFICATION at the end: finds the chromium binary and runs ldd; if any
  "not found" remains the script prints the list and exits 1 — no more silent WARN
  guards letting pods boot without a browser.
- Verified end-to-end in the prod pod: `bash /drytis-config/setup.sh` → EXIT 0,
  "Chromium dependency check OK (0 missing libraries)". Engines all true after restart.

## Notes
- `update_production_config` must be called after `update_setup_script` for the pod's
  /drytis-config/setup.sh to refresh (config tar is pushed on config update, not instantly).
- Setup script is platform-side (not in the git repo) — there is no repo file for it;
  the source of truth is the backend project config.
- prod-smoke@drytis.example / ProdSmoke!2026 remains a working prod login for engine checks.
