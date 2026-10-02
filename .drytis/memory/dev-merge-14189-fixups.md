# DEV merge (#14189) — post-merge regressions and fixes

Merge d5d9d57 (origin/DEV 66d7f85 into NIHARIKA ae6bfc6) left three latent breaks; fixed in f76a222.

## 1. `body.cli-theme` dropped from index.html (the big one)
The merge resolution kept `.cli-theme` CSS blocks but took `<body>` without `class="cli-theme"`.
The **entire desktop app layout is scoped under `.cli-theme`**: 4-column `.app` grid
(left runs | center chat | right viewer | 52px feature-dock rail). Without the class the base
3-column `.app` applies → `NAV.feature-dock` wraps onto an implicit grid row → 11–27px page
scroll at ≤1280px, and the viewer panel widened past the 27–32.5% share band at 1920/1600.
Symptom was confusing: every child of `.app` "reduced" scrollHeight when hidden, because the
implicit row is created by the dock's mere presence. Rule: after any index.html merge, diff
`<body>` attributes against BOTH parents.

## 2. Migration test paths
Migration numbering was unified to NIHARIKA's scheme (DEV's 018_run_engine_device/019_run_cohort
exist as 026/027 on disk — 018/019 are cross_platform_catalog/device_runtime here), but
server/postgres/runEngineDevice.test.js still read the DEV paths → ENOENT. Retargeted to
026/027. Note: 022 is legitimately absent from server/postgres/migrations/ (skipped number).

## 3. listAll signature test
Same file asserted `async listAll(options)` but merged postgresServices.js has
`async listAll(_options)` → loosened regex to `async listAll\(_?options\)`.

## Verification
npm test 1048/0 (20 skipped), public 107/107, test:ui PASS at all six resolutions,
test:acceptance PASS (T1–T18). Login throttle 429s from repeated test logins are in-memory in
service-bg-service-4182 — `procmgr restart service-bg-service-4182` clears it; restart also
confirmed when in doubt before reading a UI-suite FAIL as real.