# Chromium launch failure in production — root cause + fix (#12271, 2026-09-21)

## Symptom
QASE agent blocked: Playwright `chromium.launch()` failed with `libglib-2.0.so.0: cannot open shared object file`. `ldd` on `/home/coder/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome` showed **18 missing shared libs** (glib, nss, atk, cups, gbm, pango, cairo, asound, xkbcommon, Xcomposite/damage/fixes/randr, atspi...). The base Debian 12 prod image ships none of them.

## Fix (two parts)
1. Immediate: `sudo -n apt-get install -y libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0` — the `coder` user has passwordless sudo in the prod container. dbus error noise on chrome startup is harmless.
2. Persistent: added the same apt line to the project setup script (guarded, non-fatal on failure) + `update_production_config` so every pod recreation reinstalls the deps. `npx playwright install chromium` alone does NOT install OS libs — `npx playwright install-deps chromium` would, but it needs the same apt; explicit list is clearer.

## Verified
`ldd` → 0 missing; chrome --headless --dump-dom works; Playwright launch + setContent + evaluate all pass in the prod container as user coder. App still 200 at https://qase.drytis.com/.

## Note
Prod Chromium lives at /home/coder/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome (user coder, uid 1000), not /root.