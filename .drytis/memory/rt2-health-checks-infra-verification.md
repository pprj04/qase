# RT2 #14754 infra verification (2026-10) — PASS

Verified read-only; preview https://qase-2-1-cvtryq.drytis.dev/ (200), localhost:5173 (200),
qase-server prod command (`exec node server/index.js`), all 7 procmgr services RUNNING
(service restarted ~13 min after container boot when the engine-shadowing fix deployed — pid 2533).

## RT2 confirmations
- environmentHealth.js engine-launch shadow bug FIXED: `const engine = support.engine ?? 'chromium'`
  at check site (~line 149), real probe at line 84. Spot tests: environmentHealth.test.js 8/8,
  browserSupportResolution.test.js 12/12 (chunked, --test-concurrency=1, pids.current ≤437 — no pressure).
- matrixOrchestrator.js:13 imports checkEnvironmentHealth; BLOCKED → "Health check blocked execution: <reason>" (line 151).
- AVAILABILITY vocab (provider.js:19–27): AVAILABLE/PREPARING/RUNNING/BUSY/OFFLINE/ERROR/UNAVAILABLE.
- app.js:596–608: seedBoard at startup + every 60s (unref'd), preserves live BUSY statuses.
- Live board (auth'd /api/device-runtime/devices): 37,244 AVAILABLE / 1,518 UNAVAILABLE (all DuckDuckGo) —
  same baseline as RT1, consistent.
- /drytis-config/setup.sh: 6 hits for local-browsers/dpkg-deb -x — RT1 persistence fix still in place post-restart.

## Carried WARNs (still open, platform-side)
- QASE_BROWSER_ALLOWED_PRIVATE_HOSTS (env key 50925) still lists stale host qase-2-1-jywqe4.drytis.dev
  instead of current qase-2-1-cvtryq.drytis.dev.
- .qase/test-cases.json (generated run data) embeds historical preview-URL sourceUrls — informational only.

No new FAILs. Full-suite still forbidden (zombie/process-limit hazard — see
rt1-branded-browsers-persistence.md).
