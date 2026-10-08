# Matrix store persist starvation + disk-full 500s (2026-10-07)

## Symptom
"Start run is completely disabled" / API appears dead during matrix runs. POSTs
of 2,000 configs took 277–630s; UI submits hung.

## Root causes (three stacked)
1. **Sync full-file persist per item update** — `createLocalMatrixBackend` in
   `server/matrixService.js` called `persistNow()` (0.3s synchronous 36MB
   serialize+write) on EVERY `updateItem` (~8/item). Fixed with debounced
   async persistence (500ms coalesce, `persistTimer.unref()`,
   `persistInFlight` re-schedule guard; create/terminal still persistNow).
   After fix: API latency 3–90ms during a 2,000-item run.
2. **Disk full (100%, 0 free)** — login 500s (`auth.json` persist fails,
   authFailure→500), `.qase` artifacts 552MB, `opera-stable*.deb` 133MB,
   `.playwright-mcp` 84MB. Cleaned; note `/workspace` volume is only ~9.8GB —
   prune `.qase/artifacts` and stray .debs when >90%.
3. **PID exhaustion (recurring)** — RLIMIT_NPROC 7684; leftover Chrome
   renderers from big runs exhaust forks → `fork/exec: resource temporarily
   unavailable` for ALL run_bash. Only fix: `restart_container(3542)` (volume
   persists). Check `ps -e | wc -l` early when commands fail oddly.

## Other traps hit
- Login throttle is IN-MEMORY (`server/authThrottle.js`, 40/IP + 10/account,
  15min window) — a service restart clears it; DB has no attempts table in
  local store mode. Don't confuse with postgres `qase_auth_attempts`.
- Matrix API is `/api/matrix-runs` (GET/cancel/retry/start in
  `server/matrixApi.js`); the launcher POST is `/api/qa-matrix-runs` (app.js).
  Body key is `configurationEnvIds` (NOT configIds).
- CSRF: login sets `qase_csrf` cookie; send `X-CSRF-Token` header.
- Auth = cookie session, not Bearer. `/api/qa-configurations` uses
  `limit`/`offset`, rows keyed by `envId`, availability field is a string
  (e.g. 'NOT_SUPPORTED').
- Local run store: `.qase/matrix-runs.json` (~36MB/62 runs). Concurrency is 1
  sequential item at a time (QASE_MATRIX_PARALLEL clamp 1–4).

## Verification status (this fix)
- Suites: matrixService 33/33 (incl. debounce change), matrixApi all 7 tests
  pass individually (full-file run hits the 300s test timeout — run with
  `--test-name-pattern`, or accept individually-green).
- Live: 1-config run matrix-muyj8vsw → PENDING→QUEUED→RUNNING→BLOCKED, done,
  persisted to disk, API responsive throughout. 2,000-config run created in
  0.59s, items transition honestly (BLOCKED/ERROR for fixture envs), API
  never starved; cancelled mid-run.
