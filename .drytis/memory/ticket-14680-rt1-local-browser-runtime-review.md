# Review — #14680 RT1 local browser runtime registry, 2027-10-05 (follow-up re-review same day)

**Verdict: PASS** — previous FAIL (floating-promise `ensureRuntime` call sites) is fixed and verified; full suite green (1273 / 0 fail / 20 skip via `npm test` = `node --test`, NOT vitest); server restarted and live on :5173 (curl 200). All 4 previously-flagged call sites now awaited: app.js:702 (sendTask, inside async fn awaited by matrixOrchestrator.js:148), app.js:1569 (await inside try — catch now live), distributedExecution.js:140 (inside awaited runWithRequestActor body), drytisIntegrationApi.js:644 (await in try — persistStartFailure path reachable again). index.js:215 passthrough `async session => services.agent.ensureRuntime(session)` — awaited by runResume.js:169. localServices.js:116 async wrapper. agent.js:370/568 fine.

## Residual WARNs (documented, non-blocking for RT1 scope)
1. `isExecutableLocalBrand` can upgrade status=present to branded SUPPORTED without launch verification (version-only probe / null-snapshot fallback window). Mitigated by browserBridge branded-launch fallback + `fallbackUsed` + runtimeIdentity honesty.
2. server/worker.js (distributed mode) still does not wire probeLocalBrowsers/setLocalRegistrySnapshot — worker-side branded upgrades use version-only path. Dormant: distributed mode requires postgres; QASE_RUN_STORE=local here.
3. Stored (pre-RT1) coverage items can still show legacy DDG reason "no Playwright build" via dominantReason. Cosmetic/historical; new items carry the RT1 reason.

## Security
- execFile with array args, static constant paths — no injection. No secrets in new files. No spoofed-UA branded claims.

## Ops notes
- Restart the app server before live-verifying changes (see gotcha below).
- Full suite = `npm test` (node --test over server/, server/postgres/, server/controlPlane/, public/). `npx vitest run` reports "No test suite found" for every file — not this project's runner.
