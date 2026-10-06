# RT3 #14755 infra verification (2026) — RESULT: PASS

Seven standard sections all PASS. RT3-specific evidence:

- `server/interactionApi.js` present with real driver injection (touchscreen.tap, CDP touch-drag swipe, held-mouse longPress, dragTo, keyboard/wheel, setInputFiles, real refresh/back, orientation rotate with SKIPPED on non-touch — line ~344-355). `browserBridge.js:795,812-815` wires rotate + commits browser_interaction runtime facts. `browserTools.js:52` exposes browser_interaction. `defectFixtures.js:20,102` has 'device-interactions' fixture.
- Spot tests (read-only, `--test-concurrency=1` per process-limit rule): `interactionApi.test.js` 13/13 pass (14.6s), `defectFixtures.test.js` 6/6 pass (9.5s). pids stayed ~640-660, no exhaustion.
- WebKit env: libgstreamer1.0-0 1.26.2-2 installed; no webkit launch failures seen in checks; fixture page `/demo/defects/device-interactions` → 200 on localhost:5173.
- Setup script contains `npx playwright install-deps webkit` (line 30, idempotent each boot) AND the persistent branded-browser `dpkg-deb -x` extraction (lines 40-79) — both RT1/RT3 fixes hold in the materialized /drytis-config/setup.sh.
- Carried WARNs (unchanged, platform-side, not blockers): stale host in QASE_BROWSER_ALLOWED_PRIVATE_HOSTS (key 50925: `qase-2-1-jywqe4` vs current `cvtryq`); old preview host literals in `server/browserPolicy.test.js:196-215` (test-only fixtures).
