# Production browser deps after pod restart / branch switch (#14011)

The #12271 fix (Chromium system libs in setup script) is correct, but it only runs via the
setup script — and a `restart_production` that reuses the persistent volume does NOT
re-run it if the checkout already exists. After the PUSHKAR→DEV switch (2026-09-30) the
new pod had all Chromium/firefox/webkit system libs missing again → QA runs closed as
"blocked: libglib-2.0.so.0 missing".

## Fix applied in prod container (as user coder — apt needs sudo)
- sudo apt-get install: libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0
  libcups2 libxkbcommon0 libasound2 libgbm1 libcairo2 libpango-1.0-0 libxcomposite1
  libxdamage1 libxfixes3 libxrandr2 libatspi2.0-0 libx11-6 libxcb1 libxext6 libdrm2
- Then (for firefox/webkit): libx11-xcb1 libxcursor1 libgtk-3-0 libpangocairo-1.0-0
  libcairo-gobject2 libgdk-pixbuf-2.0-0 xvfb libflite1 libharfbuzz-icu0 libmanette-0.2-0
  libenchant-2-2 libhyphen0 libsecret-1-0 libwayland-egl1 libepoxy0 libgtk-4-1
  libgstreamer1.0-0 libgstreamer-plugins-base1.0-0 libgstreamer-plugins-bad1.0-0
  libgraphene-1.0-0 libatomic1 libopus0 libjxl0.7 (NOT libjxl0.11 — trixie name, we're
  bookworm), libwebpdemux2 libwebpmux3 libgles2 libx264-164 (NOT -163)
- `npx playwright install chromium firefox webkit` then succeeds clean.
- Verified: all 3 engines LAUNCH OK via playwright script; /api/engines reports all
  available:true after service restart.

## Setup script gaps to remember
The DEV setup script's webkit list has two wrong/troublesome names on Debian 12
bookworm: libjxl0.11 (doesn't exist here; correct = libjxl0.7) and it lacks
libx11-xcb1 libxcursor1 libgtk-3-0 libpangocairo-1.0-0 libcairo-gobject2
libgdk-pixbuf-2.0-0 libwebpdemux2 libwebpmux3 libgles2 libx264-164 libatomic1 libopus0.
The `|| WARN` guards hid these failures. Consider a follow-up ticket to fix the setup
script package list for bookworm.

## Prod smoke-test account
prod-smoke@drytis.example / ProdSmoke!2026 registered on qase.drytis.com for engine
verification (the dev cred.json account doesn't exist in prod's user store).
