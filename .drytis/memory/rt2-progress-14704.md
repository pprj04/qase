# RT2 (#14704) progress — IN PROGRESS, code complete, verification blocked

## State of the code (all on /workspace, NIHARIKA branch, uncommitted)
RT2 implementation is COMPLETE and unit-tested:
- `server/environmentHealth.js` (NEW, 224 lines): health gate — real probes (execution_service, browser_support resolution, engine launch incl. branded executablePath, network HEAD to targetUrl, emulation_apply validation, media_capability honest synthetic labeling). Verdict READY|BLOCKED with exact reason; TTL cache 30s; probe timeout 10s (timeout = FAIL never pass). 8/8 tests in `server/environmentHealth.test.js`.
- `server/matrixOrchestrator.js`: executeItem now runs `hooks.checkEnvironmentHealth` before RUNNING; BLOCKED → item UNAVAILABLE with `Health check blocked execution: <reason>` + healthChecks array, session never launched. services.environments passed through. Wired in app.js (~L680) with `checkEnvironmentHealth` import + `environments: services.environments`.
- `server/deviceRuntime/provider.js`: AVAILABILITY extended to AVAILABLE/PREPARING/RUNNING/BUSY/OFFLINE/ERROR/UNAVAILABLE.
- `server/deviceRuntime/manager.js` seedBoard: SIMULATED-level envs now AVAILABLE when browser support resolves executable locally (RT1 registry), UNAVAILABLE+reason when not_supported (DuckDuckGo), no-resolver/real-device semantics preserved (OFFLINE for no-provider). Async via injected `resolveBrowserSupport` (returns promise, .then updates state).
- `server/app.js` seedBoard call passes real `resolveBrowserSupport`.
- `public/deviceRuntimeUi.js`: AVAILABILITY_META labels for all 7 statuses + NOT_EXECUTABLE.
- Tests updated: deviceRuntime.test.js (2 new seedBoard tests), deviceRuntimeUi.test.js meta test, matrixOrchestrator.rt2.test.js (NEW: blocked→UNAVAILABLE never launches; healthy→proceeds).
- Setup script updated: brave/opera .deb reinstall on missing (dpkg --force-depends, brave-keyring dep missing is OK), webkit install-deps each boot.

## Verification status
- All RT2-touched test files pass standalone (environmentHealth 8/8, matrixOrchestrator.rt2 2/2, deviceRuntime 35/35 → wait, deviceRuntime.test.js 35 pass incl. new ones, deviceRuntimeUi, localBrowserRegistry 7/7, browserSupportResolution*).
- FULL suite could not complete cleanly due to CONTAINER DEFECT (see below). Before the second incident the full suite was 1273/0 fail with RT1 + partial RT2.

## CRITICAL CONTAINER DEFECT — zombie PID exhaustion (2nd occurrence)
drytis-init (PID 1) does NOT reap orphaned zombies. Every shell-tool call leaks `[cat]` zombies; browser launches leak chrome/brave/opera zombies. All reparent to PID 1 with no reaper → count grows monotonically → hits RLIMIT_NPROC (7684 for uid 1000) → EVERY fork fails EAGAIN (bash, npm, browsers, even ps). Only fix: platform restart_container (clears zombies; volume persists). Postmortem: `.drytis/memory/incident-pid-exhaustion-zombies.md` (researcher wrote it).
MITIGATIONS: minimize shell calls; run test files individually or in small groups; after restart expect ~7500 zombie slots free but they re-accumulate with every bash call (~2-4 each). A full npm test spawns ~100 node children × fork pressure — risky; prefer targeted files.

## Next steps for RT2 completion
1. Full suite (fresh container, quick, single batch with --test-concurrency=1 may be safer; or accept targeted-file verification).
2. Infra gate: procmgr status, curl 5173, preview 200.
3. Reviewer + tester delegation (tester: device board availability shows honest statuses via /api/device-runtime/devices; duckduckgo UNAVAILABLE).
4. Move #14704 Done, then RT3 #14705 (interaction APIs), RT4 #14706, RT5 #14707, RT6 #14708.

## RT tickets
#14704 RT2 (In Progress), #14705 RT3, #14706 RT4, #14707 RT5, #14708 RT6 (Open). #14680 RT1 Done.
