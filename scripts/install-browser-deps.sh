#!/usr/bin/env bash
# HOTFIX A — Chromium/Playwright system dependency installer.
#
# Called from the boot setup script. Unlike the previous inline
# `apt-get ... 2>/dev/null || true`, failures here are LOUD:
#   - logs exactly which step failed
#   - exits non-zero on dependency-install failure
# The web app is still allowed to boot (Execution Health marks local
# browser execution unavailable) — only browser execution is affected.
set -u
LIBS="libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libdbus-1-3 libxkbcommon0 libx11-6 libxcomposite1 \
  libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
  libcairo2 libasound2 libatspi2.0-0 libxshmfence1"

fail() { echo "[browser-deps] FAIL: $1" >&2; exit 1; }

echo "[browser-deps] apt-get update..."
apt-get update -qq || fail "apt-get update failed"

echo "[browser-deps] installing Chromium shared libraries..."
apt-get install -y -qq $LIBS || fail "apt-get install of Chromium libraries failed"

echo "[browser-deps] verifying Chromium launches..."
EXEC="$(ls -1 /home/*/.cache/ms-playwright/chromium-*/chrome-linux*/chrome 2>/dev/null | head -1)"
if [ -n "$EXEC" ]; then
  MISSING=$(ldd "$EXEC" 2>/dev/null | grep -c "not found" || true)
  if [ "$MISSING" -ne 0 ]; then
    fail "ldd still reports $MISSING missing libraries for $EXEC"
  fi
fi
echo "[browser-deps] OK"
