# RT4 #14756 infra verification (2026-10-05)

RESULT: PASS. Seven standard checks all clean.

- Env: 21/21 keys present in /workspace/.env by key; no orphan env files; QASE_RUN_STORE=local so no DB keys. Carried WARN: QASE_BROWSER_ALLOWED_PRIVATE_HOSTS (key 50925) still lists stale host `qase-2-1-jywqe4.drytis.dev` (platform-side, unfixed for 3+ rounds).
- RT4 tool-schema gap from the RT4 review (browser_media enum missing meeting_controls/meeting_recovery) is **RESOLVED** — browserTools.js:36 enum and :48 validator both include both actions now.
- Setup script on disk has persistent dpkg-deb -x extraction (local-browsers) + webkit-deps reinstall each boot; npm ci; conditional postgres migration. package.json has a `dev` script but service/setup use production `node server/index.js` — no dev-mode usage.
- New observation: **three stray `browserMedia(.camera).integration.test.js` node --test processes left running up to ~2h50m** (pids 15175, 15986, 35392) plus ~2,366 zombies parented to PID 1 (drytis-init does not reap — known from incident-pid-exhaustion-zombies.md). Not blocking yet (RLIMIT-style limits not hit; pids.current ~2,680) but repeated integration-test runs leak processes — matches the documented process-limit hazard pattern. Reported as WARN, not fixed (read-only).
- WebKit deps (libgstreamer 1.26.2-2) installed and live; boot reinstall in setup.sh intact.
- Spot test: browserMedia.camera.test.js 4/4 pass (concurrency 1).
