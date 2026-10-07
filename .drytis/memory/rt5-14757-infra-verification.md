# RT5 #14757 — infra verification (video evidence + coverage states + isolation)

Verified 2026-10-05, project 3542. All 7 standard checks PASS.

## Result
`RESULT: PASS` — deploy-ready. RT5 files present (browserBridge recordVideo/collectSessionVideo/setVideoSink ×11 sites; matrixCoverage COVERAGE_STATES/coverageStateOf ×23; deviceMatrixView coverageStateLabel; agent.js launchedEngineId/brandedBinary runtimeFacts; report.js states/stateCounts; both isolation/states test files; video integration test file present).

- Env: all 21 keys materialize in /workspace/.env, values resolved (QASE_PUBLIC_URL → cvtryq host). Carried WARN: QASE_BROWSER_ALLOWED_PRIVATE_HOSTS still lists stale `qase-2-1-jywqe4` (key 50925, platform-side).
- Source greps for API key/metrics token/DB creds/preview host: zero hits outside .env.
- Services: qase-server RUNNING pid 62456 post-RT5 restart, `exec node server/index.js`, no dev-mode procs, no leaked `node --test` procs this round (unlike RT4 — they were cleaned by the container restart at 3:44 uptime).
- Zombie count ~2,491 parented to init — documented known incident (incident-pid-exhaustion-zombies.md), pids.max=max so no fork hazard yet.
- artifactStore RT5 fix confirmed on disk: root resolved ONCE at store creation (lines 53-61).
- Spot test: matrixCoverage.states.test.js 4/4 pass (--test-concurrency=1). Video integration test intentionally NOT run (process-limit rule; browser-spawning test).
- Migrations: 34 postgres + 2 controlPlane migrations, all DDL confined to migration dirs. RT5 adds no schema change.
