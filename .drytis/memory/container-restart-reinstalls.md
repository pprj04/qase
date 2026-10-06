# Container-replacement state loss — what to reinstall after every restart

The container filesystem (outside /workspace volume) loses these on EVERY container replacement/restart:
1. **WebKit deps** (libgstreamer etc.): `cd /workspace && sudo npx playwright install-deps webkit` — Safari engine-equivalent execution + defectFixtures tests break without it. 3rd occurrence now.
2. **Brave**: reinstall from GitHub latest .deb with `sudo dpkg -i --force-depends` (brave-keyring dep is missing and fine to skip). Version 154.1.96.61.
3. **Opera**: `https://download3.operacdn.com/pub/opera/desktop/136.0.6008.80/linux/opera-stable_136.0.6008.80_amd64.deb`, same dpkg command. Registry fallback path /usr/bin/opera (symlink) resolves.
Chrome + Playwright engines survive (system/volume).

Setup script (updated RT1/RT2) now handles all three idempotently for DEPLOYS, but plain dev container restarts do NOT run it — reinstall manually after restart_container, or the localBrowserRegistry tests + branded execution degrade honestly but lose Brave/Opera REAL binary coverage.

Also: zombie [cat] PID exhaustion recurs in these containers (drytis-init doesn't reap; RLIMIT_NPROC 7684). Minimize shell calls; if `fork: Resource temporarily unavailable` appears, only restart_container clears it. Volume persists everything in /workspace.
